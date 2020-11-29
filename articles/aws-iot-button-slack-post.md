---
title: "AWS IoTボタンを買ってslackにポストしてみた"
emoji: "👌"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [aws, iot, awsiot]
published: true
---

:::message
この記事は2019年7月26日にqiitaに投稿したものの移行記事となります。
元記事はこちら https://qiita.com/cumet04/items/11bc8883ae9cc603b84d
:::

:::message alert
2020年11月29日現在、該当のAWS IoTボタンは販売していないようです。
[SORACOMのLTE版のボタン](https://www.amazon.co.jp/dp/B07L59ZFVF/)ならありますが、本記事の内容が適用できるかは不明です。
:::

## あらまし
ふとネットをさまよっていると、こんなものを見つけました。
https://www.amazon.jp/dp/B075FPHHGG

「こっ...これは！」

翌日の午前中には届いていました。

## AWS IoT ボタンとは
https://aws.amazon.com/jp/iotbutton/
Amazonダッシュボタンとほぼ同じハードウェアで、AWS IoTにつないで自由なアクションを起こすなどしやすいようになったボタンです。
WiFiなど^[あまり何も確認せずに購入したためWiFi以外が使えるのかは確認できていません。]でインターネットにつないでボタン押下イベントを送信することができます。

ボタン押下イベントはAWS IoTで取得し、そこからSNSやLambda起動などができます。
Lambdaが起動するということはつまり**なんでもできます**。夢が広がりますね。

## 動かしてみる

本記事では、サンプルとして「ボタンを押したらslackにメッセージをポストする」ということを行います。

### ボタンをAWS IoTに認識させる
最近のこの手のデバイスの初期設定はスマートフォン経由で行うことが多いですが、こちらも例に漏れずアプリから接続します。

スマートフォンのアプリストアよりAWS IoT 1-Clickというものを探し、インストールして起動します。
AWSアカウントを入力してログインし「デバイスIDで登録」よりバーコードスキャンを起動し、IoTボタン裏をスキャンすれば登録できました。

次にPCブラウザにてAWSコンソール > AWS IoT 1-Clickのサービスを開き、デバイスが見えないようであれば^[この時点で試行錯誤したため、スマートフォン側を先に完了すればブラウザ側での操作が必要なのかはわかりません。]登録画面より登録します。
デバイスIDはスマートフォンアプリ側で確認できる英数16文字のものです。なおこれはAmazonの注文メールにも書いてありました。

サイドメニューの管理 > デバイス にIoTボタンが登録されていればOKです。

### slackにポストするlambda関数を用意する
ボタン押下イベントから発火させる関数を用意します。

slackにてincoming webhookのURLを取得しておき^[取得方法はここでは割愛]、そこにメッセージをポストする処理を書きます。
自分はrubyを使うことが多いのでrubyで書きます。最近はランタイムの選択肢が増えてなによりですね。
今回用意したコードは以下のようになりました。

```ruby:lambda.rb
require "net/https"
require "uri"

def lambda_handler(event:, context:)
    uri = URI.parse('https://hooks.slack.com/services/XXXXXXXXX/XXXXXXXXX/xxxxxxxxxxxxxxxxxxxxxxxx')
    res = Net::HTTP.start(uri.host, uri.port, :use_ssl => uri.scheme == "https") { |http|
        http.request(Net::HTTP::Post.new(uri).tap { |req|
            req.body = {
                channel: 'random',
                username: 'dash',
                text: 'time',
            }.to_json
        })
    }
    { statusCode: 200, body: res.to_s }
end
```

テスト実行し、メッセージがポストされていればOKです。

### ボタンから関数を発火させる
AWS IoT 1-clickサービスの画面にもどり、プロジェクトを作成します。
基本的にダイアログに従って適当に入力していけば問題ないです。デバイステンプレートにて作成したLambda関数を指定しておきます。

作成できたらプロジェクトの画面に移り、プレイスメントを作成（デバイスを紐付ける的な）を行います。
プレイスメントに適当な名前をつけ、テンプレートに対してデバイスを選択します。

完了したら、おもむろにボタンを押します。

![slack post from button](https://storage.googleapis.com/zenn-user-upload/a5bzykc59ena8vdiyhdvoxk3g11j)


## まとめ
「ボタンを押してLambda関数を発火させる」ことまでできました。

あとはアイデアの赴くままに処理を書けばなんでもできますね。
