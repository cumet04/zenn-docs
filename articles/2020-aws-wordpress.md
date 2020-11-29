---
title: "2020年のAWSでいい感じWordpressインフラを組んでみる"
emoji: "📘"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [AWS, CDK, WordPress]
published: true
---

:::message
この記事は2020年7月27日にqiitaに投稿したものの移行記事となります。
元記事はこちら https://qiita.com/cumet04/items/fa1a29c6c52b0b752813
:::

これまでちょこちょこ[AWS関連の記事を書いてきた](https://qiita.com/cumet04)のですが、そういえば一般的な1システム全体のことを書いたものが無いなと気付きました。

じゃあせっかくなので1システムをキッチリ組んで思考メモをまとめよう、ということでやってみました。

題材と前提
----------

オーソドックスな題材がいいなということで、RailsかWordpressあたりかと思ったのですが、最近[Fargate+EFSが実装されたとき](https://zenn.dev/cumet04/articles/fargate-with-efs)に「Fargateで冗長化Wordpressやってみたいな」と思っていたところだったためWordpressにしました。
※実際にはFargateではなくEC2になりましたが...

その他前提としては、

* 可能な限り実運用を意識する
* 冗長化を行う
* 開発環境・本番環境はAWSアカウントレベルで分離し、それぞれ関係ないリソースは原則置かない
* Infrastructure as Codeを意識する

としています。

なお成果物はこちらです: https://github.com/cumet04/awsed-wordpress-infra


できあがった全体構成
----------

![AWSのインフラ構成図](https://storage.googleapis.com/zenn-user-upload/9qhuanj4xtnhak9ivzdimcaxp0vf)

そんな複雑でもなく、EFSがあることを除けばAWSのごく一般的な構成です。

### Network
冗長化のため2AZをベースにし、サブネットを3組（Ingress, App, Data）用意しています。

ここでの構成ではApp, Dataはともにprivate subnetになっており分離する必然性は無いのですが、Appの部分は要件によってpublicになったりNATゲートウェイが刺さったりする可能性があるため分離しています。

なおEC2があるApp部分がprivateなため、いくつかのAWSサービス利用のためVPCエンドポイントが設定されています:

* Cloudwatch Agent用; ec2, monitoring, logs [参考](https://dev.classmethod.jp/articles/private-cloudwatch-agent/)
* SSM SSH用; ec2messages, ssm, ssmmessages, s3 [参考](https://dev.classmethod.jp/articles/private-subnet-instance-ssm-ssh/)
* `yum update`用; s3 [参考](https://dev.classmethod.jp/articles/yum-update-in-private-subnet/)

AmazonLinux系のyumリポジトリがS3にありprivateサブネットでも使えるのは今回始めて知りました。便利ですね。
なおAmazonLinux2であれば時刻同期も[Amazon Time Sync Service](https://aws.amazon.com/jp/blogs/news/keeping-time-with-amazon-time-sync-service/)が[デフォルトで有効](https://dev.classmethod.jp/articles/amazon-linux2-use-chrony-and-time-sync-service-by-default/)なため、こちらは何も心配する必要がありません。

### Ingress (Cloudfront, WAF, ALB)
一般ユーザのリクエストはCloudfrontで、管理画面アクセスはALB直（別ドメイン割当）で行います。

対象となるサイトには特にユーザごとやリクエストごとに動的なコンテンツは無い想定をしており、通常の閲覧リクエストを全てCloudfrontで受ける（キャッシュする）ことでComputing系の負荷を下げます。
もし一部ページにお問い合わせフォームが存在するなどする場合にはCloudfrontのBehaviorで別途設定するなどします。

ここのセキュリティもやっておこうということで、AWS WAFをALBに紐付ける（ALBに前段に入る）ようにしています。
ここではお安く使えるAWSのマネージドルールを使っています。またALBへのアクセス制限として

* 所定IPからのリクエストは無条件許可
* `/wp-admin`へのアクセスは（上記より一段下がる優先度で）拒否
* Cloudfront以外からのアクセス（ALB直）は拒否 [参考](https://dev.classmethod.jp/articles/restrict-elb-origin-awswaf/)

というルールを設定しており、AWSマネージドのセキュリティ系ルールは優先度的にこれらの下に並ぶかたちです。
これらの条件により、管理画面は所定IPからALB直アクセスのみ可能としています。

ちなみにWAFが不要な場合であっても、上記手動アクセス制御は全て[ALBのリクエストルーティングで可能](https://dev.classmethod.jp/articles/advanced-request-routing-for-alb/)です。
WAFありでもこれらだけALBでやる、という選択肢もあるのですが、その場合管理画面アクセスにWAFのセキュリティルールが反映されてしまい操作に悪影響が発生する恐れがあるため避けています。

### Computing (EC2, AutoscalingGroup)
コンピューティングはEC2を2台（冗長化目的）並べています。
AutoscalingGroupにしていますが自動スケールアウトは設定しておらず、インスタンス/ホスト異常からの自動復旧やCDKでの管理の都合上の目的で使っています。

障害復帰はEC2のステータスチェックもありますが、最初から特定インスタンス(EBS)に依存しない状態にしておいたほうが[いざというとき](https://aws.amazon.com/jp/message/56489/)にも比較的安心ですし、取りうる選択肢が広くなります。
またCDK上で「特定インスタンス」を管理すると手動オペレーションが発生した際に整合性を気にする必要やモニタリング対象の設定などがややこしくなり、AutoscalingGroupにしたほうがわかりやすくなります。

負荷はCloudfrontで吸収する想定で自動スケールアウトは設定していませんが、CDNがある場合でもWordpressに負荷が集中する場合もあるにはある（大量の過去記事をクローリングされた場合など）ため、サイトによっては有効にしたほうがよいかと思います。

なおメトリクスやログはCloudwatch agentで送信し、webコンテンツ（ドキュメントルート配下）は全てEFSに置くことでEC2にステートを持たせないようにしています。

EC2インスタンスに入ってのメンテ系作業、いわゆるssh作業したい場合はSSM経由でsshする想定です。

#### Fargateの夢
計画当初はFargateを使おうと思っていたのですが、執筆時点ではFargate+EFSがCDK(Cloudformation)未対応でした。

[EFS紐付けだけ手動で行いそれ以外をCDKにする](https://qiita.com/r-kurokw/items/f712a5b72bc683c319c4)こともできますが、この場合後からCDKでタスク定義を変更＆反映した場合にEFS紐付け設定が消えてしまいます。
※タスク定義は変更ではなくリビジョンの新規作成のため

この挙動は運用上リスキーなため採用を見送ることとしました。残念ではありますが、ここはAWSさんの頑張りに期待ですね。
まぁEC2にしておくとEFS上のファイルを直接いじったりDBにCLIアクセス（mysqldumpやリストア含む）できたりして便利なので良しとしておきます。

ちなみにCDKではなく[Terraformを使えば実現できる](https://beyondjapan.com/blog/2020/04/fargate-supported-efs/)ようです。

### Data Store (RDS, EFS)
DBはスタンダードにRDSのMySQLです。特にひねりはありません。
強いて言えば、DBを参照するアプリケーションがEFS上（IaC管理外）にあるため、あえてパスワードなどをコード上で管理していない（する必要がない）という点があります。

ディスクストレージにはEFSを使い、ドキュメントルート以下をまるっと格納しています。EC2の`/var/www/html/`に直接マウントしています。
パフォーマンスが気になるところではありますが、そこは負荷テストしつつ必要に応じてプロビジョンするなり対応できます。

### Monitoring & Alarm
モニタリング系はCloudwatchに集約されているため、ここらにアラームを設置していきます。

通知先として適当なSNS Topicを用意しておき、実際の通知先は運用者の好みで決められるようにしています。メール通知もよし、Lambdaを発火してslackに流してもよし、AWS Chatbotを紐付けてもよし。

またRoute53を利用するのであればWeb外部監視も実行できますね。


Infrastructure as Code
----------

インフラ構成はごく一部を除きAWS CDKおよびansibleで管理しています。

実運用を考えた場合、設定変更などはまずステージング環境（開発環境）で行った後に本番反映を行う流れになりますが、設定群をコード化しておくことで「本番反映する変更点がステージングで行ったものと同一であること」を（ほぼ）保証できるためです。手順書＆手作業はつらいし怖いですよね。

**以下、[リポジトリ](https://github.com/cumet04/awsed-wordpress-infra)のコードを参照することを前提としています。**


### EC2の構成 (ansible)
[playbookディレクトリ](https://github.com/cumet04/awsed-wordpress-infra/tree/master/playbook)配下です。
本記事はAWSインフラが主眼なこと・そもそもこのEC2にはWordpressを動かす以外のことをほとんどさせていないことから、ここはポイントだけ抑えて軽めに流します。

`site.yml`より、実行している処理は

* common; EC2サーバ一般。タイムゾーンやswap、メンテ用ツールなどをとりあえず入れる
* cloudwatch_agent; cloudwatch_agentおよびその設定を入れる
* httpd; apacheサーバと設定。アクセス制御などはWAF/ALBで実施するため、ごくごく最低限の設定のみ。LogFormatに`X-Forwarded-For`入れたくらい。
* php; `php`と`php-mysqlnd`いれるだけ。`amazon-linux-extras`よりphp7.4を入れる。
* efs; efsマウントヘルパー入れるだけ
* mysql_client; メンテ用にmysqlクライアントを入れる。Wordpressの動作に必須ではない。
  - `amazon-linux-extras`を使うとphpのバージョンがややこしいので使わない。かなり古いのが入るがWordpressレベルなら多分大丈夫...？

となっています。基本的に入れるだけです。
ポイントとしては、cloudwatchのメトリクス設定にて`aggregation_dimensions`を設定することです。

```json:config.json
{
  ...
  "metrics": {
    "append_dimensions": {
      "AutoScalingGroupName": "${aws:AutoScalingGroupName}",
      "ImageId": "${aws:ImageId}",
      "InstanceId": "${aws:InstanceId}",
      "InstanceType": "${aws:InstanceType}"
    },
    "aggregation_dimensions": [["AutoScalingGroupName"]],
    "metrics_collected": {
      ...
```

こうしておくことでcloudwatchに記録される際にAutoScalingGroup名で一つにまとまったメトリクスができます。そうしないと監視対象のメトリクスが一つに定まらず、EC2全体に対してアラートを設定することができません。

またEFSについて、ansibleで実行するのはヘルパーを入れるだけです。
マウントするにはEFSインスタンスのIDが必要になるため、CDKからユーザデータ経由で実施します。

### AWSリソース (CDK)
インフラ全体はCDKの1スタックにまとめました。 `cdk/lib/cdk-stack.ts`
コード上ではリソースセットごとに`createXXX`メソッドとしてまとめ、スタックのコンストラクタからそれらを順に呼ぶかたちにしています。

この構造にして必要な値を引数として指定することで

* 個々のリソース作成が依存しているパラメータが何なのかが明示できる
* 実プロジェクト依存・チューニングで変わりそうなパラメータたち（DB名やインスタンスサイズなど）を一部分（コンストラクタ）に集約できる^[EC2の数やDBのmultiAZなど、一部外に出し切れていませんが...]
* CDK作成に試行錯誤している段階で「今はALBとWAFの繋がりが確認できればいいので時間のかかるRDSはコメントアウト」というような融通がききやすい

というメリットがあります。

#### CDKに与えるパラメータ・CDK管理外リソース
可能な限り外部から指定するパラメータは減らしましたが、それでもいくつかはCDK外で作成・指定するものがあります。

* EC2のAMI
* 各種証明書 (Cloudfront, ALB(管理画面), ALB(Cloudfrontから受けるドメイン))
* Cloudfrontのオリジンに指定するALBのドメイン名
* Cloudfront -> ALBの通信制限に使うヘッダ名・値
* Cloudfrontの閲覧を指定IPに制限するか（要するに開発環境かどうか）
* 管理者として扱うIP

ここでは~~面倒なので~~環境変数で指定していますが、どれも間違えて更新するとダメなものなので、実運用上はソースコードに直接書き込む or 手動でSSMパラメータストアに値を入れておいて参照するのが安全です。

EC2のAMI自体はCDK外で作成しますが、ARNを指定する必要は無いようにしています。
構築対象のAWSアカウントにはこのWordpress環境1セットのみ存在する想定なので、イメージ名を指定＆アカウント内から検索することで必要なAMIをCDK内で特定できます。

#### createVpc
`createVpc`メソッドを定義し、VPCまわり（VPC, Subnet, SecurityGroup, VPC Endpoint）を作成します。

VPCとサブネットについては

```typescript
const vpc = new ec2.Vpc(this, "VPC", {
  cidr: "10.0.0.0/24",
  maxAzs: 2,
  subnetConfiguration: [
    {
      name: "Ingress",
      subnetType: ec2.SubnetType.PUBLIC,
    },
    {
      name: "Data",
      subnetType: ec2.SubnetType.ISOLATED,
    },
    {
      name: "App",
      subnetType: ec2.SubnetType.ISOLATED,
    },
  ],
});
```

だけでいい感じに出来上がります^[サブネットのCIDRマスクを指定することもできますが、IP数にはかなり余裕があるのでここでは何もしていません]。CDK、便利ですね。
サブネットもこれで生成されていますが、ここで`selectSubnets`しておくことでその後の取り回しを良くしています。


次にセキュリティグループもここで作成します。（以下は抜粋）

```typescript
const sgALB = new ec2.SecurityGroup(this, "sgALB", { vpc });
...
const sgApp = new ec2.SecurityGroup(this, "sgApp", { vpc });
sgApp.addIngressRule(sgALB, ec2.Port.tcp(80));
```

セキュリティグループの内容は個々のリソース依存が強いため、リソース生成時にそのメソッド内で一緒に作るほうがスッキリしそうですが、`addIngressRule`にてアクセス元の指定で他のグループを使う（上記では`sgApp`の生成に`sgALB`の依存がある）ため、ここでまとめて作成しています。

最後にVPCエンドポイントですが、愚直に全部並べると少々長いので、対象サブネットが全部同じであることを利用してforEachでまとめています。


#### createRDS
長いので割愛しますが、必要なパラメータを地道に入れていくだけです。

なお本要件はアプリケーションがWordpressであること・その実態はEFSに手動でいれる（インフラコードで管理しない）ことから、DBのパスワードは全く管理せず自動生成（SecretManagerが使われます）に任せています。
（DBパスを必要とするのは`wp-config.php`のみで、それはEC2->EFSに手動で設置するため）

その他CDK tipsとして、CDKのコードを作っている（試行錯誤している）最中は`multiAz`および`deletionProtection`を`false`にしておくことで、AWS料金の節約・スタック削除やロールバックの際に楽ができます。


#### createEFS
ファイルストレージなのでデータストア系かなと思いDataサブネットに置いたのですが、執筆時に調べたところ、どうもEC2と同じところに置くのがよさそうです。

https://aws.amazon.com/jp/blogs/news/webinar-bb-efs-2018/

> **Q. 作成時のsubnet指定は、EFSをマウントするEC2インスタンスが所属しているsubnetを選択すればよいですか？**
> A. はい。 EC2 インスタンスが属するサブネットに EFS マウントターゲットを作成することができます。この場合、ネットワーク的にもアクセス効率の良い構成になります。


#### createInstances
EC2関連一式を含むAutoScalingGroupを作成します。
ポイントは以下です:

* 前述の通り、AMIはARN指定ではなく検索にしている
* UserDataを使ってパッケージのパッチを実施している（パッチ作業の半自動化のため）
* UserDataを使ってEFSのマウントを実施している（EFSのIDが必要なためansibleで完結できない）
* ScalingEventの通知を設定している

AMIを検索にした場合、検索結果がCDK実行ディレクトリの`cdk.context.json`にキャッシュされます。
試行錯誤の段階で同名のAMIを作り直した場合はこのファイルを消す or 編集する必要があります。

またAMIについてはEC2 Image Builderを使うのもよいと思います。今回は題材がWordpressなのでそんなに頻繁にEC2の設定・構成変更は発生しないだろうという想定で手動にしています。

#### createCloudwatchAlarms
CloudWatchのメトリクスに対しアラームをセット・通知先を設定しています。

最初に設定を作る段階では、まずアラームなしでインフラを作成 -> AWSコンソールからCloudWatchのメトリクス名を実際に見ながら作っていくのが確実です。

ここのコードは冗長な感じになっていますが、案外共通化できる要素が少ないため愚直にコピペで並べています（SNSトピックの設定だけまとめた）。

#### createALB
ALBを作り、ターゲットグループ（AutoScalingGroup）および証明書を割り当てます。

通信許可などの設定はWAFで行う構成なのでシンプルですが、WAFなしの場合はここでリスナールールを設定することになりそうです。

#### createWAF
WAFのルールおよびACLを作りますが、執筆時点でWAFにはLow Level Construct (CdnXXXのようなリソース。CDKでいい感じになっていないもの) しかなく^[Constructの種類は[こちら](https://dev.classmethod.jp/articles/aws-cdk-construct-explanation/)参照]、コードがかなり冗長になっています。
仕方ないので型定義を見ながら愚直にコードを書いていきます。

ここではIPSet, RuleGroup（カスタムルール）, WebACLを定義しています。
RuleGroupにしていする`capacity`の値は推測ができない（推測方法がわからない）ため、同じルールをAWSコンソールで作成し、そこに表示されるCapacityをそのまま使っています。

なおWebACLを作成する際の`rules`の指定には`overrideAction`（もしくは`action`）を指定する必要があり忘れるとエラーが発生するのですが、**そのエラーメッセージから上記原因を全く推測できない**ので注意が必要です。
CDKでのWAF作成にハマった際にはこれを思い出し、エラーメッセージを無視して上記の点を確認することをオススメします。以下参考。
https://dev.classmethod.jp/articles/aws-cdk-create-wafv2/

#### createCloudfront
CloudfrontのDistributionを作成します。

型定義に従って作成すればよいのですが、（多くの場合）**priceClassは明示的に指定する必要がある**点に注意が必要です。デフォルトにしておくと欧米でしか使えなくなります。

また本記事の内容では正規の証明書を使っていないためCNAMEを指定していない（できない）ですが、あらかじめ正規の証明書が使えるのであればコードの時点でCNAMEsを指定できるはずです。
...はずなのですが、CNAMEを指定するには`aliasConfiguration`属性を指定する必要があり、このパラメータはdeprecatedとなっています。推奨手段（[リポジトリ](https://github.com/cumet04/awsed-wordpress-infra)で使っている`viewerCertificate`）で証明書は指定できますがCNAMEsを指定する手段は見当たらないため、警告に沿うのであればいずれにせよCNAMEsは手動指定が必要かもしれません。


初期構築手順
----------
詳しくは[リポジトリ](https://github.com/cumet04/awsed-wordpress-infra)のREADMEにあるので割愛しますが、ざっくりまとめると

1. AmazonLinux2インスタンスにplaybookを投入したAMIを用意する
2. ACMで証明書を用意する
3. 上記を環境変数にセットし、CDKを投入する
4. EC2経由でEFSにWordpressを設置する
5. DNS設定（とCloudfrontのCNAMEsの設定）をする

となります。


まとめ
----------
インフラ一式の構築を全て集約したのでかなり長くなりましたが、思考メモくらいにはなったと思います。

実用的にはコンテンツバックアップをやりたい（EFSのデータ・DBダンプをS3に日次で吐き出したい）と思っていますが、ひとまずここまでとなります。

一部分でも何かの参考になれば。
