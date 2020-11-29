---
title: "AWSでk3sクラスタを構築する（CDK編）"
emoji: "😎"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [AWS, kubernetes, CDK, k3s]
published: true
---

:::message
この記事は2019年9月30日にqiitaに投稿したものの移行記事となります。
元記事はこちら https://qiita.com/cumet04/items/2dbc099919d81de88e4a
:::

[前回](https://zenn.dev/cumet04/articles/setup-k3s-manual)はEC2のUserDataでk3sクラスタを手動生成したので、今回はそれをAWS CDKでもう少ししっかりコード化して組んでみました。
前提として、実際のKubernetesクラスタとしての運用はしっかり考えてはおらず、ざっくり全体を組み上げる程度としています。^[そもそも筆者はk8sクラスタをしっかり運用したことがないためしっかり考えられません...]

## 何を作るか
k3sのmaster nodeが1台、agent nodeが複数（オートスケーリング）のクラスタを構成するCloudFormation StackをAWS CDKで定義します。
前回記事ではEC2とParameterStoreくらいしか触っていませんが、今回はせっかくなのでその周辺にあるリソースも広く触っていきます。

定義・作成するリソース以下です:

* IAM role
* VPCまわり・SecurityGroup
* EC2 LaunchTemplate
* AutoscalingGroup
* (SSM ParameterStore)^[ParameterStoreはクラスタとしては利用しますがCDKでは定義しません。]

なお筆者はこのリソース作成でCDK入門しましたが、この記事ではCDK入門は長くなるので扱いません。
AWSネタなので、[こちら](https://dev.classmethod.jp/server-side/serverless/aws-cdk-ga-serverless-application/)や[こちら](https://dev.classmethod.jp/cloud/aws/cdk-workshop-typescript/)など[クラスメソッドさんとこの記事](https://dev.classmethod.jp/referencecat/cdk/)を見ておくとよいと思います。


## 定義コード
作ったもの全体は[こちら](https://github.com/cumet04/k3s_cluster/tree/qiita/k3s)になります。^[npmでなくyarnを使っていますが、完全に筆者の好みというだけなのでnpmでいいと思います]
定義したスタックは1つだけなので、書いたコードは`lib/k3s-stack.ts`がほぼすべてです。

以下、個々の定義リソースをざっくり見ていきます。

### tap

```typescript
function tap<T>(value: T, fn: (value: T) => void): T {
  fn(value);
  return value;
}
```

突然ですがリソースではなくユーティリティです。Rubyの`tap`と同じ目的のものです。
リソースの子にリソースを入れ、かつ子リソースでメソッド実行しておく場合に使っています。^[これ自分でサッと実装できなかったのですが、[twitterでつぶやい](https://twitter.com/cumet04/status/1173521675364646912)ていたら @ktsn 先生がスッと作ってくれました。素晴らしいｲﾝﾀｰﾈｯﾂですね！]

### EC2用のIAM role

```typescript
const master_role = new iam.Role(this, "IAMRoleMaster", {
  assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
  inlinePolicies: {
    k3s_write_master_info: tap(new iam.PolicyDocument(), doc => {
      doc.addStatements(
        tap(new iam.PolicyStatement({ effect: iam.Effect.ALLOW }), st => {
          st.addActions("ssm:PutParameter");
          st.addResources("arn:aws:ssm:*:*:parameter/k3s/master/*");
        })
      );
    })
  },
  managedPolicies: [
    iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonEC2RoleforSSM")
  ]
});
```

master側インスタンスにつけるIAMロールです。
IPやnode-tokenを入れる用の`ssm:PutParameter`がついたインラインポリシーとSSM ssh用のマネージドポリシーをつけています。

ここでPolicyDocumentを生成する際に`addActions`や`addResources`されたStatementを入れたものをひとまとめに書きたかったために前述の`tap`を使っています。
（...が、記事執筆時にリファレンスをよく確認したところ、コンストラクタの引数でまとめて指定できるようなので、特にこのtapがなくてもひとまとめに書けそうでした...）

このmaster側ロールと同様にagent側も作りますが、内容としてはSSMの権限が`PutParameter`ではなく`GetParameter`になってる以外はリソース名くらいしか差分がないので省略です。


### VPCまわり・セキュリティグループ

```typescript
const vpc = new ec2.Vpc(this, "VPC", {
  cidr: "10.0.0.0/22",
  maxAzs: 2,
  subnetConfiguration: [
    {
      name: "Master",
      subnetType: ec2.SubnetType.PUBLIC,
      cidrMask: 28
    },
    {
      name: "Agent",
      subnetType: ec2.SubnetType.PUBLIC,
      cidrMask: 24
    }
  ]
});

const secgroup = new ec2.SecurityGroup(this, "SecurityGroup", { vpc });
secgroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.allTcp());
```

シンプルにVPCとセキュリティグループです。master-nodeは1台想定ですが、せっかくなのでちゃんとサブネット切ります。
VPCはこれだけの記述でいい感じに必要な数のサブネット・ルーティングテーブル・インターネットゲートウェイを全部用意してくれます。
このあたりは手動で作るとだいたい一旦作り忘れるし、従来のCloudFormationで記述すると信じられないくらい冗長でめんどくさいところだったのでCDKさまさまですね。

セキュリティグループは~~面倒だったので~~シンプルにmaster/agent共用・VPC内は全ポート開放にしました。
なおここでは`aws-ec2.SecurityGroup`クラスを使っていますが、現在このクラスは接続元をCIDRブロック指定しかできないようです。
特定セキュリティグループからの通信を～というような制御をしたい場合には`aws-ec2.CfnSecurityGroup`クラスを使うことになるのだと思われます。

### EC2周辺リソース

```typescript
const amzn2_image_id = new ec2.AmazonLinuxImage({
  generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2
}).getImage(this).imageId;
const root_block_device = (size: number): ec2.CfnLaunchTemplate.BlockDeviceMappingProperty => {
  return {
    deviceName: "/dev/xvda",
    ebs: {
      deleteOnTermination: true,
      volumeSize: size,
      volumeType: "gp2"
    }
  };
};
```

LaunchTemplateを定義する際に使うプリミティブ的な値・メソッドです。
どちらも複数回登場する上に、表現したいことに対して記述が長いので予めまとめておきます。

CDKでのコード定義だとこのような見やすさなどの工夫もできてよいですね。

### LaunchTemplate

```typescript
const master_template = new ec2.CfnLaunchTemplate(this, "MasterTemplate", {
  launchTemplateData: {
    instanceType: new ec2.InstanceType("t3.micro").toString(),
    imageId: amzn2_image_id,
    networkInterfaces: [
      {
        associatePublicIpAddress: true,
        deviceIndex: 0,
        groups: [secgroup.securityGroupId],
        subnetId: vpc.selectSubnets({ subnetName: "Master" }).subnetIds[0]
      }
    ],
    blockDeviceMappings: [root_block_device(8)],
    iamInstanceProfile: {
      arn: new iam.CfnInstanceProfile(this, "InstanceProfileMaster", {
        roles: [master_role.roleName]
      }).attrArn
    },
    userData: fs.readFileSync("lib/userdata/master.sh").toString("base64")
  }
});
```

master-nodeのLaunchTemplateです。EC2起動に必要なパラメータ群を指定しています。
userDataは別ディレクトリ/ファイルとして読み込んでいます。

セキュリティグループやIAMロールなど、これまでに定義した各リソースを入れ込んでいます。
サブネットも定義した名前で取得できてよいですね。

userDataの実際の中身は[リポジトリ](https://github.com/cumet04/k3s_cluster/tree/qiita/k3s/lib/userdata)参照ですが、[前回記事](https://zenn.dev/cumet04/articles/setup-k3s-manual)と[簡単SSM-ssh用設定](https://zenn.dev/cumet04/articles/ssm-ec2-sandbox-template)を一緒にしたものになっています。

agent-node用もほぼ同様で、違うのはIAMロール・userDataの他、agentはサブネットを指定していないところです。
agentはAutoScalingGroupの設定でサブネットを指定しますが、masterはLaunchTemplateから直接EC2起動する想定のため、ここでサブネットを指定しています。


### AutoScalingGroup

```typescript
new autoscaling.CfnAutoScalingGroup(this, "AgentScalingGroup", {
  maxSize: "4",
  minSize: "0",
  launchTemplate: {
    version: agent_template.attrLatestVersionNumber,
    launchTemplateId: agent_template.ref
  },
  vpcZoneIdentifier: vpc.selectSubnets({ subnetName: "Agent" }).subnetIds
});
```

agent起動用のAutoScalingGroup定義です。シンプルにLaunchTemplateとサブネットを指定しています。
今回はCDK Stack投入とクラスタ起動タイミングは別にしたかったため、minSizeをゼロに指定しておいてコンソールから手動で要求数を変えることで起動するようにしています。

LaunchTemplateのバージョン指定には`$Default`や`$Latest`が存在しますが、どうもCloudFormationでは使えないらしく、ここでは定義したテンプレートの最新バージョンを指定しています。

またこのリソースは他から参照されないため、特に変数にしていません。

## 投入・起動してみる
出来上がったコードを`tsc`して`cdk deploy`してしばらく待てば、LaunchTemplateやAutoScalingGroupなど準備できた状態になります。

クラスタを起動するにはまずmaster-nodeを起動します。
webコンソールにて、master用のLaunchTemplateからインスタンス作成を実行します。必要なパラメータはすべて指定してあるため、何もせずそのまま作成できます。

masterが起動してきた頃合いでagent用のAutoScalingGroupの要求インスタンス数を上げてインスタンス起動します。
userDataのスクリプトやk3sサービスが起動し、特になにもせずともクラスタ化するはずです。

masterサーバにsshし`kubectl get node`すると

```
[ec2-user@ip-10-0-0-13 ~]$ kubectl get node
NAME                                            STATUS   ROLES    AGE   VERSION
ip-10-0-1-26.ap-northeast-1.compute.internal    Ready    worker   85s   v1.14.5-k3s.1
ip-10-0-2-189.ap-northeast-1.compute.internal   Ready    worker   76s   v1.14.5-k3s.1
```

2台のagentがReadyになっていることが確認できました。

## まとめ
やってみた的な最低限なものですが、AWSでのk3sクラスタ構成をコードで記述できました。
実運用には色々と足りないですが、そのベースになるくらいの雰囲気はできていると思います。

AWS CDKはサクサク書いていくにはある程度慣れが必要な印象でしたが、リファレンスを見ながら書いていけばなんとかなりますし、少なくともCloudFormationよりは圧倒的に気持ちよく書けます。

また、せっかく作ったからにはもう少しk3sネタで遊んでみたいと思います。
