---
title: "SSMと起動テンプレートを使って最速でお砂場EC2を用意する"
emoji: "👏"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [AWS, EC2, SessionManager]
published: true
---

:::message
この記事は2019年8月4日にqiitaに投稿したものの移行記事となります。
元記事はこちら https://qiita.com/cumet04/items/ddbb567335c79d181a63
:::


「面白そうなプロダクト出てるな。ちょっとEC2用意して遊んでみるか。」

そう思ったとき、何も考えずにEC2にsshするところまで辿り着くための下準備設定を用意してみました。

## 方針
起動テンプレートを使うことで諸々の設定をすっ飛ばします。
またSessionManagerのsshを使うことでアクセス元IP制限や秘密鍵の手間を減らします。

※インスタントなお砂場想定のため、長期安定性やちゃんとしたセキュリティはあえてそれ相応です。

## SessionManager
セッションマネージャを使えば、awscliによるIAM認証でsshすることができます。

インスタンスに対する秘密鍵の管理の必要がなくなり、またセキュリティグループで22ポートを開ける必要がないため自宅のグローバルIPがころころ変わる場合でも使いやすいです。

このセッションマネージャによるsshの導入については詳細はこれらの記事を見るのがオススメです:
https://dev.classmethod.jp/cloud/aws/ssm-session-manager-release/
https://dev.classmethod.jp/cloud/aws/session-manager-launches-tunneling-support-for-ssh-and-scp/

本記事では詳細な説明は省略しますが、あらかじめ準備しておくことは以下となります。

* awscliの設定を済ませておく
* `AmazonEC2RoleforSSM`が付与されたIAM roleの作成
* （クライアントマシンで）[セッションマネージャプラグインのインストール](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
* 下記ssh configの追記

```
host i-*
  ProxyCommand aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p'
```

その他サーバ側の設定は起動テンプレート側に記述します。

## 起動テンプレート
起動テンプレートには自分のお好みの設定＋SSMのsshに必要な設定を埋めていきます。
ポイントとなるのは以下です:

* AMI ID: AmazonLinux2のもの^[SSMエージェントが入れられればなんでもよいはず]
* インスタンスタイプ: お好みで入力しておく
* キーペア・セキュリティグループ: SSMするので不要
* セキュリティグループ: SSMするので不要
* IAMインスタンスプロフィール: 事前に準備した`AmazonEC2RoleforSSM`のものを指定
* ユーザデータ: 以下で入力

```bash:ユーザーデータ
#!/bin/bash

yum install -y https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm

passwd -d ec2-user

sed -i /etc/ssh/sshd_config -e 's/^#PermitEmptyPasswords.*$/PermitEmptyPasswords yes/g'
sed -i /etc/ssh/sshd_config -e 's/^PasswordAuthentication no$/#PasswordAuthentication no/g'
sed -i /etc/ssh/sshd_config -e 's/^UsePAM yes$/#UsePAM yes/g'
systemctl reload sshd
```

記事執筆時のAmazonLinux2 AMIではSSMエージェントのアップデートが必要だったためyumコマンドでインストールしています。

ssh設定については`ec2-user`を認証なしログインできるようにしています。
22ポートは開けず、認証はawscliで行うことを前提とした方針です。

また起動テンプレートにはお好みでスポットインスタンスのリクエストを入れておくとリーズナブルになります。


## 実際に動かす
準備ができたのでインスタンスを作成してsshします。
実際に行うことは

1. 起動テンプレートからインスタンスを起動する画面に遷移
2. ソーステンプレートのバージョンを選択して起動ボタンを押す
3. インスタンス一覧の画面に戻り、インスタンスIDをコピーしておく

だけです。設定ダイアログをポチポチ進めたり秘密鍵を探したりセキュリティグループを追加したりする必要はありません。
あとは少し待ってインスタンスが起動したら

```bash
ssh ec2-user@i-XXXXXXXX
```

するだけで見慣れたshell画面が登場します。簡単ですね。

## awscliも使う
これだけでも簡単ですが、よりサクッとterminalから作れるようにスニペットを用意しました。^[[jq](https://github.com/stedolan/jq)がインストールされてない人はいれましょう]

```bash:インスタンス起動＆ID表示
aws ec2 run-instances --launch-template '{"LaunchTemplateId":"lt-xxxxxxxxxxxxxxxxx"}' | jq -r '.Instances[].InstanceId'
```

```bash:インスタンスリスト表示
aws ec2 describe-instances | jq -r '.Reservations[].Instances[] | [.State.Name, .LaunchTime, .InstanceId] | @csv' | sort | column -t -s","
```

## まとめ
地味に面倒なEC2作成作業ですが、起動テンプレートとSSMを活用して楽にできました。

一度頑張って用意しておくと、以後のサーバ遊びが大変捗ります。
