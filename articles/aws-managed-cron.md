---
title: "AWSマネージドでEC2サーバ群の1台にcronする"
emoji: "🦔"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [aws, ssm, lambda, runcommand, cron]
published: true
---

:::message
この記事は2020年1月29日にqiitaに投稿したものの移行記事となります。
元記事はこちら https://qiita.com/cumet04/items/5888e037105e6ea5f6bc
:::

AutoScalingなどEC2冗長化されたシステムにて、いい感じに1台だけからバッチしたい。
そう思ったときにサクッと出来る仕組みがなかったので作ってみました。

## 要件とアイデア
やりたいことは次のような要件です。

* EC2内でコマンド実行したい
  - サーバ内ミドルウェアに依存した処理やDB接続などを行う場合、Lambdaでやるとsecretsや通信経路などややこしくなります。
* AutoScaling環境など、複数のEC2があるけど1台だけで実施したい
  - 集計をしてDBに書き込むなどのようなバッチだと複数台から同時実行されると困ります。
* crontab置きたくない
  - AutoScalingではcrontabを1台だけ有効など難しく、また全部に置いて排他を行うのもややこしい。

これらを以下のようにAWSサービスを組み合わせれば解決できそうです。

* CloudWatch EventsのタイマーでLambdaを発火させる
* LambdaにてEC2リスト取得＆1台だけ選ぶ
* 同Lambda内から、選んだ1台に対してSSM RunCommandでコマンド実行させる

と考えたあたりで調べたところ、近いことを既にやっている人がいました。
https://dev.classmethod.jp/cloud/aws/lambda-ssm-pseudo-cron/

そのままやると二番煎じ感があるので、本記事では以下の点も掘り下げます。

* IAM Roleの権限を絞る
* エラー時に通知する

## 順番にやってみる
* 指定タグが付いたEC2を一覧するLambdaを作る
* RunCommandでコマンド実行する
* コマンド失敗を通知する
* 時限発火する

なお最終的なLambdaのコード全体は[こちら](https://gist.github.com/cumet04/342f44291b716e990e66f7d4e3c69f52) ^[記事内容は半分くらいIAM Roleの話なのでコードだけあってもあまり意味ないですが...]

### 指定タグが付いたEC2を一覧するLambdaを作る
適当にLambda関数を作ります。ここではPython3.7を選び、IAM Roleは新規デフォルトで作成します。

#### とりあえずリストする
まずはミニマムにインスタンスをリストしてみます。

指定のタグが指定の値であるインスタンスのリストを出力するコードは以下のようになりました。

```python
import boto3
ec2 = boto3.client("ec2")

def lambda_handler(event, context):
    tagname = "cron"
    tagvalue = "true"
    resp = ec2.describe_instances(Filters=[{"Name": f"tag:{tagname}", "Values": [tagvalue]}])
    instances = []
    for resv in resp["Reservations"]:
        for i in resv["Instances"]:
            instances.append(i)
    print(instances)
```

EC2のDescribeInstancesを実行するため、Lambdaに紐づけているIAM RoleのPolicyに`ec2:DescribeInstances`を付与します。AutoScalingを想定しているため、Resourceは特に絞りません。
なおデフォルトで`logs:CreateLogStream`と`logs:PutLogEvents`が付与されていますが、Lambda自体のログ出力に使っているのでそのままにしておきます。

権限設定をすればあとは実行するだけですが、先に一覧されるインスタンスを用意してきましょう。
EC2であればなんでもよいですが、後でSSMでコマンド実行するためSSM Agentを入れておくとよいです。

なお筆者は[お砂場EC2を最速で建てるテンプレ](https://zenn.dev/cumet04/articles/ssm-ec2-sandbox-template)があるのでそれを使いました。

作ったEC2にタグをつけたらLambdaをテスト実行します。成功するとログ出力の欄に

```
START RequestId: b708f625-271c-400d-9004-5f2331960b53 Version: $LATEST
[{'AmiLaunchIndex': 0, 'ImageId': 'ami- ...長いので略
```

となります。

#### コード整理＆一つだけ選ぶ
エラー処理やSSMの実行の考慮してメソッドを整理しつつ、インスタンスを1台だけ選ぶようにします。

```python
import boto3
ec2 = boto3.client("ec2")

def lambda_handler(event, context):
    try:
        targets = target_instances("cron", "true")
        if len(targets) == 0:
            print("No Targets")
        execute(targets, ["touch /tmp/testfile"])
    except Exception as e:
        raise e

def target_instances(tagname, tagvalue):
    resp = ec2.describe_instances(Filters=[{"Name": f"tag:{tagname}", "Values": [tagvalue]}])
    instances = []
    for resv in resp["Reservations"]:
        for i in resv["Instances"]:
            instances.append(i)
    return [instances[0]]  # 先頭の1件を選ぶ

def execute(targets, commands):
    ids = [i["InstanceId"] for i in targets]
    # TODO: impl
    print(f"targetId: {ids}")
    print(f"commands: {commands}")
```

executeの中身がダミーなのでEC2での処理は実行されませんが、ログ出力にインスタンス1台のIDとコマンドが出力されます。


### RunCommandでコマンド実行する
コマンド実行には`ssm.send_command`を使います。`execute`を書き換えて

```python
import boto3
ec2 = boto3.client("ec2")
ssm = boto3.client("ssm")

...中略...

def execute(targets, commands):
    ids = [i["InstanceId"] for i in targets]
    ssm.send_command(
        InstanceIds=ids,
        DocumentName="AWS-RunShellScript",
        Parameters={"commands": commands, "executionTimeout": ["3600"]},
    )
```

とします。

またSendCommandのため、LambdaのRoleのPolicyに権限を足します。

* Action: `ssm:SendCommand`
* Resource: `arn:aws:ec2:ap-northeast-1:YOUR_ACCOUNT_NUMBER:instance/*`, `arn:aws:ssm:ap-northeast-1:*:document/AWS-RunShellScript`

なおdocumentを指定する際にAWSアカウント番号を指定すると動きません。ドキュメントは自作じゃないのでそれはそうですね。

これでLambdaを実行すると、EC2インスタンスの内1台に`/tmp/testfile`が生成されるはずです。
なお実行権限はrootになっていました。


### 失敗を通知する
SendCommandは非同期なので、コレ自体でコマンドの成功・失敗を検知することはできません。
代わりにSendCommandにSNS ARNを指定しておき、コマンドの結果に応じて通知させることができるので、それを利用します。

#### IAM Roleを準備する

準備がややこしいのですが、Lambda以外に作成するリソースは以下です:

* 通知先のSNSトピック（と適当なサブスクリプション）
* そのトピックに通知を発行できるIAM Policy
  - Action: `sns:Publish`, Resource: 上で作ったトピック
* SSMからそのPolicyを使えるRole

SNSトピックとサブスクリプションは適当に作ります。

SSMから通知できるRoleは作成手順が少々特殊で、^[https://docs.aws.amazon.com/systems-manager/latest/userguide/monitoring-sns-notifications.html のTask 3] ^[参考ドキュメントでは`ec2.amazonaws.com`を残していますが、試したところ無くても大丈夫でした]

1. IAMの画面から「ロールの作成」画面へ遷移（ここは普通）
2. 「このロールを使用するサービスを選択」で何でもいいので適当にサービスを選ぶ
3. 先程作った通知発行用Policyを選び、そのままロール作成完了する
4. ロール一覧より作成したロールをクリックし詳細画面へ遷移、更に信頼関係タブより「信頼関係の編集」をクリック
5. Statement.Principal.Serviceの値を`ssm.amazonaws.com`に書き換え、更新する

となります。要するに「このロールを使用するサービス」でSSMを選んだようなロールを作るのですが、UI上の選択肢に無いのであとから書き換えています。

このRoleが作成できたら、Lambdaに付与しているRoleからPassRoleできるようにしておきます。（Action: `iam:PassRole`, Resource: 作ったSSMのRole）

#### 通知をコードに反映させる
Lambdaのコードを以下のようにして、作成したSNS TopicやRoleで通知するようにします。

```python
...略...

        execute(targets, ["false"]) # 試しに失敗するようにしておく

...略...

def execute(targets, commands):
    notify_sns_arn = (つくったSNSのARN)
    service_role_arn = (作ったSSM用RoleのARN)
    ids = [i["InstanceId"] for i in targets]
    ssm.send_command(
        InstanceIds=ids,
        DocumentName="AWS-RunShellScript",
        Parameters={"commands": commands, "executionTimeout": ["3600"]},
        ServiceRoleArn=service_role_arn,
        NotificationConfig={
            "NotificationArn": notify_sns_arn,
            "NotificationEvents": ["TimedOut", "Cancelled", "Failed"],
            "NotificationType": "Command",
        },
    )
```

実行するとSNS Topicに通知が発行され、メールが飛ぶなりするはずです。実際に飛んできたデータは以下のようになっていました。

```json
{
  "commandId": "e697a732-0ec1-473d-9d75-c4f4512dd28a",
  "documentName": "AWS-RunShellScript",
  "instanceIds": [
    "i-0xxxxxxxxxxxxxxxx"
  ],
  "requestedDateTime": "2020-01-28T05:00:45.727Z",
  "expiresAfter": "2020-01-28T07:00:45.727Z",
  "outputS3BucketName": "",
  "outputS3KeyPrefix": "",
  "status": "Failed",
  "eventTime": "2020-01-28T05:00:46.99Z"
}
```

標準出力や標準エラーがここから取れるわけではないので、実運用ではサーバ上のファイルやCloudWatch Logsに流すなどして都度見ることになりそうですね。


### 時限発火する
あとは時限発火ができれば完成です。ここは特に難しいことはなく、

* lambdaの画面のDesignerエリア左のトリガーを追加
* CloudWatch Eventsを選択
* 新規ルールの作成を選んで適当に名前とスケジュール式を入力して追加

で完了します。時刻がUTCな点に気をつけつつ、入力欄のサンプルに従って設定すればできると思います。

## まとめ
まぁちょろっとできるかなと思ってやってみたら案外詰まってしまいました。

サービスロールやPassRoleが絡んだIAMはまだまだ理解できてない点が多いので、色々試してみたいと思います。
