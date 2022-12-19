---
title: "CDK for Terraformを実務でちょっと入れてみての気付き"
emoji: "🔨"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [cdktf,terraform,awscdk,cdk]
published: false
published_at: 2022-12-21 00:00
---

以前よりちょっと気になっていた、TerraformをCDKで（普通のプログラミング言語で）記述できるCDK for Terraform （以後CDKTF）ですが、10月頃から実務で導入し始めているので、気になったところや感想を紹介します。

まだ「導入し始めている」程度なのでガッツリとした運用や設計知見があるわけではないですが、自分の観測範囲では「触ってみた」以上の記事を全然見かけないため、少しでもリアル寄りの話を提供できたら良いなと思い、記事にしてみました。

## 導入環境とまえおき
まず導入を始めている環境について軽く紹介します。業務としては、現在AWSでEC2で構築されたwebサービスをコンテナ (ECS/Fargate) 化するというプロジェクトであり、そこで新規作成するリソースを中心にCDKTFでIaCを書いていくことにした、というものです。

プロジェクト前のプロダクトにはAWSのIaCは存在せず（EC2を管理するansibleのみ存在）、IaCに限って言えば事実上の新規導入になります。そのため、既存のterraform (HCL) 資源があるものからの移行は行っておらず、移行まわりの知見は本記事にはありません（そこが気になるという方が多いとは思いますが...）。


## よく聞く・想像していたメリットはそのままうれしい
従来のterraformのHCLで書くものに比べ、事前に聞いていた・想像していたメリットはざっくりと以下のようなものでした。

* 一般プログラミング言語の高い表現力で、冗長性を廃するなどいい感じに書ける
* 型による静的解析・IDEによる補完が活用できる
* 既存の資産やドキュメントの量、またAWS以外も含めたインフラ管理ができるなどといったterraformのメリットをそのまま使える

現時点でしばらく書いてみた感想としては、これら思っていたメリットはほぼそのまま享受できています。コード表現については設計を少々考え直す必要がありますが（後のセクションで触れます）、それ以外は単純にそのまま嬉しい点になっています。

リソース定義の属性はterraformのそれと同じなため、terraform(HCL)で構築したブログ記事やドキュメントをそのまま参照できて便利です。筆者の場合、似た構成をHCLで管理している隣のプロダクトのコードをコピペして調整したりできています。

また型による補完が効くのも嬉しいのですが、型定義のコメントからterraformのドキュメントに飛べるのが地味ながらとても役に立っています。例えば[AWSのサブネットの属性の型](https://github.com/cdktf/cdktf-provider-aws/blob/6b4965235d2869c7642ceac4c9793b203d4003ab/src/data-aws-subnet/index.ts#L9-L61)ですが

```typescript
export interface DataAwsSubnetConfig extends cdktf.TerraformMetaArguments {
  /**
  * Docs at Terraform Registry: {@link https://www.terraform.io/docs/providers/aws/d/subnet#availability_zone DataAwsSubnet#availability_zone}
  */
  readonly availabilityZone?: string;
  /**
  * Docs at Terraform Registry: {@link https://www.terraform.io/docs/providers/aws/d/subnet#availability_zone_id DataAwsSubnet#availability_zone_id}
  */
  readonly availabilityZoneId?: string;
  /**
  * Docs at Terraform Registry: {@link https://www.terraform.io/docs/providers/aws/d/subnet#cidr_block DataAwsSubnet#cidr_block}
  */
  readonly cidrBlock?: string;
...
```

と、属性の上にリンクがあり、vscodeであればCtrl+クリックで開けます。実際にコードを書くときは、適当にリソースのコンストラクタを途中まで書く -> それっぽい属性名を入力し、補完に任せてエンター -> 属性名の型定義にジャンプして一覧を眺める、ということをするのですが、その流れでドキュメントまで見れます。大変怠惰に書けて便利です。

昨今の技術選定において（社内外問わず）既存資産の量は重要なので、この点はとても良いです。


## リソースの定義順と参照順に依存関係がある
コード設計関連のトピックで、プログラミング言語での記述ではリソースの定義順と参照順に依存が発生するという点があります。これだけ書くと何を言っているのかという感じですが、ひとまず簡単な例を挙げます。

```
// ECSタスクに付与するタスク実行ロール
resource "aws_iam_role" "task-execution-role" {
  managed_policy_arns = [
    "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
  ]
  ...
}

// ECSタスクを起動するロール。例としてGitHub Actionsから起動するイメージ
resource "aws_iam_role" "github-actions-role" {
  inline_policy {
    policy = jsonencode({
      Statement = [{
        Action   = ["ecs:RunTak"]
        Effect   = "Allow"
        // ここでタスク定義リソースを参照
        Resource = "${aws_ecs_task_definition.service.arn}:*"
      }]
    })
  }
  ...
}

// ECSタスク本体のタスク定義
resource "aws_ecs_task_definition" "service" {
  // ここでタスク実行ロールのリソースを参照
  execution_role_arn    = aws_iam_role.task-execution-role.arn
  container_definitions = file("task-definitions/service.json")
  ...
}
```
※例には不要な属性をかなり端折っています

長くなるので属性をかなり端折っていますが、HCLで書いたECSのタスク定義とそのタスク実行ロール、そしてそのタスクを起動できるロールの定義です。リソース間に参照による依存が発生しているのがポイントです。これをほぼそのままCDKTFのTypeScriptで書くとこうです。

```typescript
const execRole = new IamRole(this, 'task-execution-role', {
  managedPolicyArns: [
    'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
  ],
  ...
});

const githubRole = new IamRole(this, 'github-actions-role', {
  inlinePolicy: [{
    policy: new DataAwsIamPolicyDocument(this, 'runtask', {
      statement: [{
        actions: ['ecs:RunTask'],
        effect: 'Allow',
        resources: [`${taskdef.arn}:*`]  // `taskdef` はまだ未定義なのでエラー
      }]
    })
  }],
  ...
});

const taskdef = new EcsTaskDefinition(this, 'service', {
  executionRoleArn: execRole.arn,  // ここの参照は正しく通る
  containerDefinitions: ...
  ...
});
```

となります。この場合は単に`githubRole`の定義を後に持ってくれば動きますが、たとえば上のIAMリソース2つとECSリソースを別のファイルや関数に分離している（IAMだけを一纏めのファイルで定義しているなど）場合はそうは出来ません。
※TypeScriptでの参照を諦めてarnを文字列で書いても解決は可能です

普通にプログラミングをする思考からすると至極当然ではあるのですが、HCLでは逆に（少なくとも同一モジュール内では）この制約はなく、自由にリソース定義・相互参照できそれを前提にコード全体を設計できます。HCLにおける諸々の設計はこの条件下でなされるため、これを前提にした設計をそのままCDKTFに持ち込むと問題があるかもしれません。

そんなに入り組んだ依存はそう頻繁にはないかもしれませんが、とはいえこういう制約があるという点を念頭に置いてコード分割やファイル構成などの設計を行う必要がありそうです。

筆者はまだ深い調査はできていませんが、もしかすると同じ条件と長く向き合っているであろうCDK（for Terraformではない本家のAWS CDK）の界隈に何か参考になる知見があるかもしれません。


## terraformコマンドは普通に使える
ここまではコードの話でしたが、その外のコマンド実行についても触れます。

CDKTFの設計としては、いわゆるプログラミング言語で書く部分ではコードによるインフラ定義およびterraformで使えるtf.jsonの生成 (synth) までを行い、それ以降のplanやapply、tfstate管理はterraformに任せるようになっています。

[CDKTFのCLIの実装](https://github.com/hashicorp/terraform-cdk/tree/main/packages/cdktf-cli)をざっと読んでみた^[React実装なため一般的なCLIと比べるといくらか挙動を追いづらいですが、とはいえコード自体は割と読みやすかったです]のですが、planにせよapplyにせよ、事前の設定チェックやUIの上書きが入る以外はほぼterraformコマンドのラッパーでした。またsynthについてもcdktf.jsonで指定する外部コマンド（TypeScript版の場合は `ts-node main.ts` など）をオプション環境変数付きで実行しているだけに見えました。

つまり（initやgetなど一部のコマンドを除けば）通常運用においてはcdktfコマンドなしでも作業が可能です。実際にcdktfコマンドを経由せずにterraformコマンドを直接使う作業も混ぜたりしていましたが、特に問題なく使えています。
※cdktfのplan/applyは毎度synth（ビルド）を実行するので、コードを変更せずに複数回/複数環境に実行する際はそのほうが早い

筆者の環境ではTypeScriptで書いているのでcdktfコマンドを使うハードルは低いですが、他の言語で書く場合やCLIツールのオーバーヘッドが高いのが嫌な場合などはcdktfコマンドが不要な環境を整えても良いかもしれません。またCI環境や関連ツールの兼ね合いでterraformコマンドを直接使いたい場合も問題なく対応できます。


## 専用CLIのapply時の確認挙動が軽い
これは非常に細かいというか、実用上はさほど問題にならないお気持ち的な話ですが、terrraformとcdktfでapplyコマンドを実行した際の確認が少し違います。まずはterraform applyをすると最後に以下のような確認が表示されます。

![](/images/cdktf-real-try/terraform-apply.png)

書いてある通りですが、"yes"を入力してエンターすることで実行できます。そのままエンターでも"y"でもダメです。

次にCDKTFでのapply（CDK的にはdeploy）です。

![](/images/cdktf-real-try/cdktf-apply.png)

選択肢が3つあり、アローキーで選択してエンターで確定です。デフォルトではキャプチャのようにApproveが選択されており、applyコマンドを実行後そのままエンターを押したら実行されます。

インフラの変更なので安全寄りに倒してほしいと個人的には思うのですが、CDKTFでは非常にあっさりと反映される仕様です。現実的にはplanして内容を見てからapplyするので、applyコマンドを打った時点で中断する場合は少なく問題にはなりにくいですが、とはいえこう...terraformでは良い感じに配慮した仕様だったことを思うと退化しているようで微妙な気持ちです。

これ単体のためにそこまですることはないと思いますが、他にも理由があれば前述のようにterraformコマンドを直接実行することも視野に入れても良いかもしれません。


## 雑感・まとめ
今のところの全体の感想としては、前評判や事前のイメージ通りにいつものプログラミング言語による表現力の恩恵を受けて、かつ目立った困難もなく、よい体験ができているように思います。現在は新規導入のみで、既存のHCL資産があるプロジェクトからの移行は体験しておらずそちらの温度感はわかりませんが、新規導入に限って言えば採用アリだと思います。

「触ってみた系ばかりでリアルな導入体験の話が見当たらない」と記事を書き出しておきながら、まだ触ってみたを半歩出た程度のことしか書けないなというのが正直なところですが、導入しようと思うがあともう半歩の勇気が、くらいの方の参考になれば幸いです。

また、「こんなんで導入してみたを語ってもらっては困る、本物の導入記を見せてやる」という方は是非よりリアルな知見を広めていただければうれしいです。というか、自分が読みたいのでよろしくお願いします！
