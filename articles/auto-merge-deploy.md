---
title: "「CI通ったらmergeしてリリースします」を自動化してみる"
emoji: "🔥"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [githubactions]
published: true
---

筆者が関わっているプロダクト（Webサービス）の開発ではGitHubリポジトリにup to date before mergingのブランチ保護制約が設定されているため、レビューなどが通ったPull Requestをリリースする際に

1. チームのSlackでリリース宣言をする
2. （多くの場合mainブランチが先行しているので）Update branchし、その上でCIが通るのを待つ
3. CI通ったタイミングを見計らい、Pull Requestをmergeし、デプロイジョブを発火する

という手順を踏んでいます。

しかしながらこれが完全に定型作業でめんどくさいのです。何より「CIが通るのを待つ」のが地味に面倒なのです。その数分間は他の作業に集中できないし、よくmergeを忘れて他メンバーに指摘されてごめんなさいするのがつらいのです。

というわけで、自動化できないかとやってみました。

## アプローチ
GitHubには、Pull Requestの自動マージ（以降、auto-merge）という機能があります。

https://docs.github.com/ja/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request
https://zenn.dev/dzeyelid/articles/5ab31d2cc162b1

任意のPull Requestに対しauto-mergeを有効化すると、ブランチ保護設定に規定された条件（レビューステータスや必須CIなど）を満たしたときに自動的にmergeされるようになります。要するに「CI通ったらmerge」ができます。

これを活用すると、冒頭で紹介したリリースフローは

1. auto-merge有効化 & Update branchする（手動）
2. auto-merge有効化にフックしてSlackにリリース宣言する（actionsで実装）
3. CIが通り次第mergeされる（auto-mergeの機能）
4. auto-mergeされたPull Requestのcloseにフックしてデプロイジョブを発火（actionsで実装）

とでき、メンバーが手動で操作する部分は1. だけになります。このように、auto-merge機能といくつかのGitHub Actionsの実装で一連のフローを自動化できると考えました。

ということで、実際にサンプルリポジトリに実装していきます。
 

## サンプルリポジトリを用意する
まずは想定環境を模したサンプルリポジトリを用意します。最低限設定する要件は
* なんらか時間がかかるCIがある
* かつそれがBranch protection ruleになっている
* 更にup to date before merging制約が有効

としておきます。というわけでまず用意したCIがこちら。

```yml:.github/workflows/long_test.yml
name: some long test
on:
  pull_request:

jobs:
  long-test:
    runs-on: ubuntu-latest
    steps:
      - run: sleep 60

  failable:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: sleep 30
      # if './hoge' exists, this test passes
      - run: ls hoge
```

:::message
実際に動かすGitHub Actionsのジョブにはtimeout-minutesをつけねばならぬという掟がありますが、記事中ではノイズになるので意図的に省略しています。
:::

あとでCIが失敗する場合のテストがしたいので、ファイルの有無で成否を調整できるテストも用意しています。そしてリポジトリのBranch protection ruleを以下のように設定しています。

![](/images/auto-merge-deploy/repository.png)

またauto-merge機能をリポジトリレベルで有効にしておきます。リポジトリのSettingsのGeneralのページの下の方、Pull Requestsセクションに Allow auto-merge というオプションがあるのでチェックします。

これでサンプルリポジトリの手配は完了です。なお、実際に用意したリポジトリは以下のものです。

https://github.com/cumet04/sbox_auto-merge-and-deploy


## auto-mergeの挙動を確認する
auto-merge機能自体については[冒頭で記載したzennの記事](https://zenn.dev/dzeyelid/articles/5ab31d2cc162b1)にて豊富なスクリーンショットも交えていい感じに説明されています。なので本節では、この記事で対象にするユースケースに絞っての操作を確認します。

ここでは「自分が出したPull Requestがレビュー完了しCIも終わり、あとはリリースするだけ。でもmainブランチが先行しているのでUpdate branchが必要」というシチュエーションを考えます。これをサンプルリポジトリで適当に再現^[サンプルは筆者一人のリポジトリなのでレビュアーは居ませんが、実験上の問題は無いのでよしとします]したところ、下記のようになりました。

![](/images/auto-merge-deploy/before-merge.png)

この状態から"Enable auto-merge"を押すとauto-mergeが有効になります。そこで更に"Update branch"も押しておくと、Update branch後のCIが完了したあとに自動的にPull Requestがmergeされます。いい感じです。

:::message
Enable auto-merge時にmerge方法を選べますが、これを選んだとしても別にUpdate branchを勝手にやってくれるわけではありません。忘れずに自分で両方押す必要があります。
:::

正直、merge後にデプロイをするわけではなかったり、元々mainブランチのpushイベントでデプロイするようにセットアップされている場合であれば、これだけでもワンステップ楽になっているので十分かもしれません。


## auto-mergeが押されたときに通知する
auto-merge機能は良い感じに動くことが確認できたので、追加アクションを実装していきます。

Pull Requestに対してauto-mergeを有効化すると、[auto_merge_enabledイベント](https://docs.github.com/ja/actions/using-workflows/events-that-trigger-workflows#pull_request)が発生します。これを使うと、「auto-mergeが押されたときに通知する」は以下のように実装できます。

```yml:.github/workflows/notify-deployment-start.yml
name: notify deployment start
on:
  pull_request:
    types: [auto_merge_enabled]

jobs:
  notify-deployment-start:
    runs-on: ubuntu-latest
    steps:
      - run: echo -e "CI回ったらリリースします by ${{ github.event.pull_request.auto_merge.enabled_by.login }}\n[${{ github.event.pull_request.title }}](${{ github.event.pull_request.html_url }})"
```

実用的にはSlack通知などをするところですが、ここではechoでお茶を濁しています。メッセージはイベントを使って適当に作っていますが、`github.event.pull_request.auto_merge.enabled_by.login` でEnable auto-mergeしたユーザを取得できるので、入れておくとよいでしょう。

このactionを用意しておくと、Enable auto-mergeされた直後に下記のようにジョブが実行されます。ジョブ内容としてSlack通知を実装していれば、実際にメッセージが飛ぶことでしょう。

![](/images/auto-merge-deploy/mawattara.png)

なおauto-mergeはキャンセル（disable）できるので、リリースしようと思ったけどやっぱりやめたーができます。その場合は auto_merge_disabled で補足できるので、必要であれば同様に通知してもいいでしょう。


## auto-merge完了したときにデプロイジョブを発火する
リリース宣言はできたので、merge後にデプロイジョブを発火します。

デプロイジョブ自体はなんらか既存のものがあると想定しますが、ここではGitHub Actionsで実装されているとして以下のものを用意しました。

```diff:.github/workflows/deploy.yml
 name: deploy
 on:
   workflow_dispatch:
+  workflow_call:

 jobs:
   deploy:
     runs-on: ubuntu-latest
     steps:
     steps:
       - run: echo "Start deploy ${{ github.sha }}"
       - run: sleep 10
       - run: echo "Complete deploy"
```

中身はなんでもよいのですが、これ自体を別のワークフローから呼び出す必要があるので、このワークフロー自体に `on.workflow_call` を追加しています。

そしてauto-mergeされたら上記ジョブを呼ぶ、というaction定義は以下のようになりました。

```yml:.github/workflows/auto-merge-deploy.yml
name: auto merge deploy
on:
  pull_request:
    types: [closed]

jobs:
  auto-merge-deploy:
    if: github.event.pull_request.auto_merge != null
    uses: ./.github/workflows/deploy.yml
```

発火条件はあくまで「auto-mergeによってmergeされた」場合としたいので、`on.pullrequest.closed`をワークフローの起動条件としつつ、ジョブのifで`pull_request.auto_merge`の有無を確認しています。

:::message
このイベントからworkflow_callを呼んだ場合にワークフローが実行されるcommitはどこなのか（意図通りmergeされた後のmainブランチで実行されるのか）を、出力される`github.sha`から確認したところ、ちゃんとmerge後のcommitで発火していました。
:::

ここではシンプルに（auto-mergeであれば）無条件デプロイにしていますが、変更ファイルによってメッセージや挙動を変える（docsのみの変更であればデプロイしないなど）というのも実用的には良さそうです。

:::message
デプロイジョブについて「ここではGitHub Actionsで実装されているとして、とかお前それJenkins先生の前でも同じこと言えんの？」との声もあるかと思いますが、その場合はこちらの記事を参考に何かしらactionsから発火しましょう。
https://zenn.dev/cumet04/articles/private-api-from-actions
:::


## auto-mergeが失敗したときに通知する
ここまでのフローで、リリース宣言からデプロイジョブ発火までできたので、あとはデプロイ完了を待って確認などを行うだけです。正常系においては。

しかし、Update branch後にCIが回っているということは、当然失敗する可能性が存在しています。それでいてauto-merge有効化後にリリース宣言までしているので、それができなかった（CIがコケた）場合にはなんらか通知してほしいです。なのでこちらの実装も試みます。

実現方法については試行錯誤したのですが、結果的に以下のようになりました。

```yml:.github/workflows/notify-deployment-failed.yml
name: notify deployment failed
on:
  workflow_run:
    types: [completed]
    workflows: 
      # 失敗の監視対象とするワークフロー（ジョブではない）の名前。下記は最初に用意したワークフローの名前
      - some long test

jobs:
  notify-deployment-faield:
    runs-on: ubuntu-latest
    if: github.event.workflow_run.conclusion == 'failure'
    env:
      # actionsのtokenをGH_TOKENとしてghコマンドに渡す
      GH_TOKEN: ${{ github.token }}
    steps:
      - run: |
          PR_URI="/repos/${{ github.event.repository.full_name }}/pulls/${{ github.event.workflow_run.pull_requests[0].number }}"
          if (gh api "${PR_URI}" | jq --exit-status .auto_merge > /dev/null); then
            echo -e "CIが失敗したためリリースを中断します"
          fi
```

少々コードが複雑ですが、意図した動作を日本語で書き下すと「`on.workflow_run.workflows`で指定したワークフローがfailureステータスで終了し、かつ該当ワークフローに紐づくPull Requestにauto-mergeがセットされていた場合に通知を発火する」となります。

実装側は、GitHub Actionsで定義されたワークフローの開始・終了を捕捉できる[workflow_runというイベント](https://docs.github.com/ja/actions/using-workflows/events-that-trigger-workflows#workflow_run)があるので、それを使って監視対象のCI（のワークフロー）の終了を起点としています。更にjobのifで失敗の場合のみ実行するように絞り、ghコマンドで該当Pull Requestがauto-mergeかどうか確認しています。

workflow_runで発火するワークフローの中から取得できる情報（`github.event`）にはPull Requestのフルの情報（と、それに紐づくauto-mergeオブジェクト）が無いため、Pull Request番号からURLを組み立ててghコマンドで取得しています。なおworkflow_runの元となったワークフローとしてはPull Requestは複数紐付き得るというデータ構造になっていますが、運用上は複数にならないだろうということで`workflow_run.pull_requests[0].number`とゼロ番目に決め打ちしています。

:::message alert
この失敗検知についてはあまりシンプルなアプローチが見つけられなかった^[CI関連の他のイベントには、check_run, check_suite, statusというドキュメント上は目的にフィットしたものがあります。しかし、筆者が試した限りでは（少なくともactionsによるCI前提では）どれも使えなかった/動きませんでした。さほど情報量はありませんが、試したときのログは[scrap](https://zenn.dev/link/comments/0e0e5abd90eeb1)にあります。]ため、見ての通りピタゴラ感が強めな仕組みになってしまっています。執筆時点では運用テストはできていないため、上記をそのまま動かすとなにか問題がある可能性は否定できません。
:::

workflow_runの仕様上、監視対象とするワークフローは`on.workflow_run.workflows`に明示的に列挙する必要があるため、テストを追加したときなどにこちらの追加が漏れないように工夫する必要はありそうです。


## まとめ
ここまでのワークフローを設定すると、アプローチのセクションで述べたフローが実現でき、かつ失敗時のカバーもできるようになります。

本記事ではワークフローを3つ作成していますが、これらは互いに依存していません。なので、試しにauto-merge機能だけ入れてみたり、デプロイ発火ワークフローまで入れるが通知系は入れずに運用カバー、などといった部分導入もできると思います。

少々ニッチなネタですが、運用自動化を頑張りたい方は参考にしてみてください。
