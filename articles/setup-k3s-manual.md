---
title: "AWSでk3sクラスタを構築する（手動編）"
emoji: "🦁"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [aws, kubernetes, k3s]
published: true
---

:::message
この記事は2019年9月15日にqiitaに投稿したものの移行記事となります。
元記事はこちら https://qiita.com/cumet04/items/f0422bfafaa3e8b53ac7
:::

AWS EC2でk3sクラスタを構築する土台を作ります。
k3sの場合「動かしてみた」は本当にコマンド一つで完了してしまいますが、
ここでは自動セットアップやスケーリングなどを視野にいれたちょっとちゃんとしたものを作ります。

最終的には起動テンプレートやAWS CDK (CloudFormation)を使ってコードとしてまとめることを見越した上で
本記事では手動でAWSコンソールやsshをポチポチして作ってみます。

## 公式提供スクリプト風のことをやってみる
k3sは公式でk3sセットアップ用のスクリプト ( https://get.k3s.io/ ) を用意しています。
そのまま使うとそこそこいい感じにしてくれるので、これを参考にセットアップしていきます。

### スクリプトをざっと読む
スクリプトで実行していることをまとめると、ざっくり以下のことをしています。

* k3sバイナリのダウンロード
* バイナリの設置・symlink作成
* 運用系スクリプトの設置（killall, uninstall）
* systemd/openrcサービス関連ファイル設置（古いものの削除・環境変数ファイル・サービスファイル）
* サービスの起動

※スクリプト最下部のエントリポイントの関数呼び出しをまとめただけです

オプションなどの分岐が多かったり、設置するスクリプトやサービスファイルをヒアドキュメントで全部書いてあるなどして非常に長く見えますが、やっている事自体は非常にシンプルになっています。

### 実際に作ってみる
これらの内容のうち、本記事の想定でミニマルにセットアップする際に必要な作業は以下です:

* k3sバイナリのダウンロード
* バイナリの設置・symlink作成
* systemdサービスファイル設置
* サービスの起動

k3sのserver側(k3s master)^[server側というのは用語としてややこしいのですが、k3sコマンドに沿ってそのまま表記します。また、いわゆるサーバはEC2インスタンスと表記しておきます。]・agent側でそれぞれEC2インスタンスを2台用意し、セットアップしていきます。
なおEC2インスタンスはAmazonLinux2利用・VPCデフォルトセキュリティグループ使用（実際にはagent->serverに6443が通れば良い）の想定です。

※ここからは実際にサーバ構築を行いますが、都度作ったり消したりを繰り返すため、あらかじめ[起動テンプレートを準備しておく](https://zenn.dev/cumet04/articles/ssm-ec2-sandbox-template)と楽ができます。

#### server側
まずserver側のセットアップをshellコマンドにするとこんな感じです:

```bash
# バイナリダウンロード＆設置
curl -L https://github.com/rancher/k3s/releases/download/v0.8.0/k3s -o /usr/local/bin/k3s
chown root:root /usr/local/bin/k3s
chmod +x /usr/local/bin/k3s

# symlink
for cmd in kubectl crictl ctr; do
  ln -s /usr/local/bin/k3s /usr/local/bin/$cmd
done
```
※k3sのバージョンは自分が試したときの最新です

つぎにsystemdのサービスファイルを設置します。

```:/etc/systemd/system/k3s.service
[Unit]
Description=Lightweight Kubernetes
Documentation=https://k3s.io
After=network-online.target

[Service]
Environment=K3S_KUBECONFIG_MODE=644
ExecStart=/usr/local/bin/k3s server --disable-agent
ExecStartPre=-/sbin/modprobe br_netfilter
ExecStartPre=-/sbin/modprobe overlay

KillMode=process
Delegate=yes
LimitNOFILE=infinity
LimitNPROC=infinity
LimitCORE=infinity
TasksMax=infinity
TimeoutStartSec=0
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

設置したらサービスを起動します。

```bash
systemctl daemon-reload
systemctl start k3s
```

本記事ではserver側はagent無効にしています。systemdサービスファイルの中身は公式スクリプトをほぼ流用しています。

また`Environment=K3S_KUBECONFIG_MODE=644`を指定していますが、これを指定することで非rootユーザでkubectlを実行できます。
root権限でしかkubectlしない想定ならなくても問題ないです。

k3sサーバが起動できたらnode-tokenを取得します。`/var/lib/rancher/k3s/server/node-token`をcatするなりしてコピーしておきます。

#### agent側
次にagent側をセットアップしますが、作業内容はserver側とほぼ同じでk3sの起動コマンドと環境変数が異なるのみです。

systemdのサービスファイルからEnvironmentとExecStartの行を消し、以下を追加した版でセットアップします:

```
Environment=K3S_URL=https://{server側マシンのローカルIP}:6443
Environment=K3S_TOKEN={コピーしておいたnode-token}
ExecStart=/usr/local/bin/k3s agent
```

問題なければこれでagentが起動・クラスタに加入するはずなので、実際に確認します。server側インスタンスで以下を実行します。

```bash
$ kubectl get node
NAME                                               STATUS   ROLES    AGE   VERSION
ip-172-31-xx-xxx.ap-northeast-1.compute.internal   Ready    worker   41s   v1.14.5-k3s.1
```

## SSM ParameterStoreを使う
作業としては簡単にk3sクラスタが出来上がりましたが^[実際にはmanifest適用方法を確保したり稼働させたいサービスによってEC2インスタンスのポートを開けたりALBを配置するなどあるかと思います。]、node-tokenの取得・反映のところに手作り感が拭えません。
せっかくAWSを使っているので、SSM ParameterStoreを介してこの部分を自動化します。

### スクリプトを用意する
期待する挙動は「server起動後にIPとtokenを書き込み、agent起動前にそれらを環境変数として読み込み」ですが、systemdではそれぞれExecStartPostとExecStartPre、EnvironmentFileで実現できます。^[EnvironmentFileはサービス起動のたびに評価されるため、ExecStartPreで動的に値をセットする運用が可能です]

そこでまずExecStartPre/Postで実行するスクリプトを用意します。

```bash:server側スクリプト
#!/bin/bash

ip=$(hostname | cut -d'.' -f1 | cut -d'-' -f2,3,4,5 | tr '-' '.')
aws ssm put-parameter --region ap-northeast-1 --name /k3s/master/host --value "$ip" --type "String" --overwrite 

token=$(cat /var/lib/rancher/k3s/server/node-token)
aws ssm put-parameter --region ap-northeast-1 --name /k3s/master/token --value "$token" --type "String" --overwrite 
```
service起動後に実行される想定で、IPアドレスとnode-tokenをParameterStoreに保管しています。
IPアドレスは`ip addr`あたりから取得するのが正当かと思いますが、プライベートIPに絞るのが面倒だったので`hostname`からshell芸で取得しています。

```bash:agent側スクリプト
#!/bin/bash

host=$(aws ssm get-parameter --region ap-northeast-1 --name /k3s/master/host | grep '"Value"' | sed 's|[^:]*: "\([^"]*\).*|\1|')
echo "K3S_URL=https://${host}:6443" > /opt/k3s.env

token=$(aws ssm get-parameter --region ap-northeast-1 --name /k3s/master/token | grep '"Value"' | sed 's|[^:]*: "\([^"]*\).*|\1|')
echo -n "K3S_TOKEN=$token" >> /opt/k3s.env
```
service起動前に実行される想定で、ParameterStoreから取り出したIPアドレスとnode-tokenをEnvironmenFileの形式で書き出しています。
awscliの結果からValueを取り出したいのですが、jqコマンドが入っているわけでもないのでここでもshell芸で頑張っています。

これらをEC2インスタンス内に設置しserviceファイルに指定すれば動作するはずです。

### systemd serviceに組み込む
このスクリプトを組み込んだ状態で動作テストを行いますが、基本は前にやった手順にスクリプト設置を差し込む差分があるだけです。

server側では

* systemd serviceのServiceセクションに`ExecStartPost=/opt/k3s_env_put.sh`を足す
* service起動前に、前述のスクリプトを`/opt/k3s_env_put.sh`として設置＆実行権限を付与しておく

です。その手順で実行すると、k3s起動後にParameterStoreに値が書き込まれているはずです。^[実際に組み込んで動かす前に、EC2インスタンスに該当Parameterの読み書き権限がついたIAM roleを設定しておく必要があります。]

次にagent側は

* systemd serviceのServiceセクションに`ExecStartPost=/opt/k3s_env_setup.sh`と`EnvironmentFile=/opt/k3s.env`を足す
* service起動前に、前述のスクリプトを`/opt/k3s_env_setup.sh`として設置＆実行権限を付与しておく
* **`/opt/k3s.env`を空ファイルでよいのでtouchコマンドなどで作成しておく**

です。EnvironmentFileに指定したファイルが存在しない場合、サービスの起動自体が失敗してしまうので予め作るだけ作っておきます。

うまくいけば、これでagentも正しく起動するはずです。

## EC2のuserdataに流し込んで自動化する
ここまでできれば、初期セットアップはすべてshell scriptで完結できるようになっています。

つまり、EC2インスタンス起動時にすべてをuserdataスクリプトとして設定しておけば、ただインスタンスを起動するだけですべてが完了します。

### 投入するスクリプト
server側とagent側でスクリプトは違いますが、半分くらいは同じなので部分ごとに記載します。
利用時はmergeしてください。

```bash:server側特有の部分
cat > /opt/k3s_env_put.sh << 'EOF'
#!/bin/bash

ip=$(hostname | cut -d'.' -f1 | cut -d'-' -f2,3,4,5 | tr '-' '.')
aws ssm put-parameter --region ap-northeast-1 --name /k3s/master/host --value "$ip" --type "String" --overwrite 

token=$(cat /var/lib/rancher/k3s/server/node-token)
aws ssm put-parameter --region ap-northeast-1 --name /k3s/master/token --value "$token" --type "String" --overwrite 
EOF
chmod +x /opt/k3s_env_put.sh

service_section="
Type=notify
Environment=K3S_KUBECONFIG_MODE=644
ExecStart=/usr/local/bin/k3s server --disable-agent
ExecStartPost=/opt/k3s_env_put.sh
"
```

```bash:agent側特有の部分
cat > /opt/k3s_env_setup.sh << 'EOF'
#!/bin/bash

host=$(aws ssm get-parameter --region ap-northeast-1 --name /k3s/master/host | grep '"Value"' | sed 's|[^:]*: "\([^"]*\).*|\1|')
echo "K3S_URL=https://${host}:6443" > /opt/k3s.env

token=$(aws ssm get-parameter --region ap-northeast-1 --name /k3s/master/token | grep '"Value"' | sed 's|[^:]*: "\([^"]*\).*|\1|')
echo -n "K3S_TOKEN=$token" >> /opt/k3s.env
EOF
chmod +x /opt/k3s_env_setup.sh
touch /opt/k3s.env

service_section="
Type=exec
ExecStart=/usr/local/bin/k3s agent
EnvironmentFile=/opt/k3s.env
ExecStartPre=/opt/k3s_env_setup.sh
"
```
ExecStartPre/Postのスクリプトの設置とserviceの差分の定義を行っています。

スクリプト設置時のヒアドキュメントでは、区切り単語（正式な呼称がわかりませんがここでは`EOF`のことです）をシングルクォーテーションで囲っておくことで不要な変数展開が行われないようにしています。

```bash:共通スクリプト
#!/bin/bash

K3S_VERSION=v0.8.0
BIN_DIR=/usr/local/bin

### ここにserver/agent特有の部分を入れる

curl -L https://github.com/rancher/k3s/releases/download/$K3S_VERSION/k3s -o $BIN_DIR/k3s
chown root:root $BIN_DIR/k3s
chmod +x $BIN_DIR/k3s

for cmd in kubectl crictl ctr; do
  ln -s $BIN_DIR/k3s $BIN_DIR/$cmd
done

cat > /etc/systemd/system/k3s.service << EOF
[Unit]
Description=Lightweight Kubernetes
Documentation=https://k3s.io
After=network-online.target

[Service]
${service_section}
ExecStartPre=-/sbin/modprobe br_netfilter
ExecStartPre=-/sbin/modprobe overlay

KillMode=process
Delegate=yes
LimitNOFILE=infinity
LimitNPROC=infinity
LimitCORE=infinity
TasksMax=infinity
TimeoutStartSec=0
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now k3s
```

まとめるとこれも長いように見えますが、ヒアドキュメントが長いだけで操作内容は大したことないです。

### 実際にやってみる
上記userdataを入れた状態でまずserver側をインスタンス作成し、すこし時間をずらしてagent側も作成します。  

これまでの説明の備考にもある程度書いていますが、インスタンス作成時に設定されているべきことは

* なにかしらsshする手段を用意する（動作確認用。22ポートを空ける or セッションマネージャ）
* agent -> server のTCP 6443が空いている
* EC2インスタンスからParameterStoreにアクセスできる（serverからput-paremeter, agentからget-parameter権限）
* server/agentそれぞれのuserdata

となります。これでserver/agentを起動すると、特に追加作業を入れることなくk3sクラスタが出来上がっているかと思います。

## まとめ
セットアップをスクリプト化してuserdataに入れることで、ほぼ自動化できそうな感じでk3sクラスタを構築できました。

まだk8s manifestを入れる手段を用意していなかったりnode-tokenが（SecureStringではない）ただのStringだったりしますが、
このままCloudFormationなどに記述していけばちゃんとクラスタにできそうです。

（2019/9/30 追記) AWS CDKで記述しました https://zenn.dev/cumet04/articles/setup-k3s-cdk
