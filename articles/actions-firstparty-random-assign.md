---
title: "GitHub Actionsでのランダムアサインをサードパーティ無しで"
emoji: "🙋‍♂️"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [githubactions]
published: true
---

チームでdependabotを運用し始め、検証やリリースの責任者としてassigneeをランダムに設定したくなりました。自動化したいのでGitHub Actionsでの実現方法を調べたところ、どうも各々が自前のactionを作り公開したり、他の人のそれらを利用したりしているようでした。

そんな複雑なことをするわけでもないのにそんなサードパーティのものを使うのもなぁ...ということで、よりシンプルにyaml定義一本で実現するものを作ってみました。

## アイデアと成果物
assignee割当などgithubの操作をactionsで実現する場合、[GitHub-hosted runnersのubuntuイメージに入っているghコマンド](https://github.com/actions/virtual-environments/blob/main/images/linux/Ubuntu2004-Readme.md#cli-tools)を使う、もしくは[actions/github-script](https://github.com/actions/github-script)を使う方法があります。アサイン自体はこれらで簡易に実現できるので、あとは「ランダムに一人選ぶ」ができればほぼ完成です。
※actions/github-scriptは公式提供でありサードパーティではないという認識です

最初にactions/github-scriptを使ったJavaScript実装を作ったのですが、shellでも（ghコマンドを使うパターンでも）よりシンプルに実現できると気付いたので、それら両方のパターンを作っています。

また筆者のユースケースでは[PullRequestのレビュアー割当にCODEOWNERSを使っている](TODO)のですが、実現したいランダムアサインの候補者がCODEOWNERSと一致するため、候補者をここから読むパターンも作りました。

成果物だけ見たい方はこちらをどうぞ（一番上は別のものです）

https://github.com/cumet04/sbox_gh-actions/blob/bbce06b0900f0c8fbc1d8c95478aad1a3895fd4f/.github/workflows/pullreq-assign.yml


## JavaScript実装
まずはJavaScript実装 (actions/github-script実装) です。

```yaml
  random-assign-js:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/github-script@v6
        with:
          script: |
            const names = [
              'foo-',
              'bar-',
              'baz-',
            ]
            const index = Math.floor(Math.random() * names.length)
            const assignee = names[index]

            github.rest.issues.addAssignees({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              assignees: [assignee]
            })
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        if: ${{ toJSON(github.event.pull_request.assignees) == '[]' }}
```

actions/github-scriptのscript部分はJavaScriptが動くので、シンプルに「配列の要素からランダムに一つ選ぶ」を実装し、その結果からoctokitでアサインしています。

### 候補者を用意する
まず候補者一覧を用意します。actions的にはwithやenvで渡すことが多いように思いますが、このJavaScript実装の場合は直接配列で保持したほうが扱いやすいのでscript内に書いています。

```javascript
const names = [
  'foo-', // 実際に見知らぬ人をアサインしてしまうと困るので、githubユーザ名として不正な（末尾ハイフンな）値を仮置き
  'bar-',
  'baz-',
]
```

なおCODEOWNERSからの取得は以下です。

```javascript
const owners = require('fs').readFileSync('.github/CODEOWNERS').toString()
const names = owners                               // '* @foo @bar @baz\napp/ @foo\n...'
  .split('\n')[0]                                  // '* @foo @bar @baz'
  .replace(/^\* /, '')                             // '@foo @bar @baz'
  .split(' ').map( name => name.replace('@', '') ) // ['foo', 'bar', 'baz']
```

※地道な文字列加工でわかりにくいため、各行の加工後のサンプルをコメントで補足しています

これはCODEOWNERSの記載が全ファイル宛(`*`エントリ)に一行だけ書いているという前提です。以下のようなイメージです。

```
* @member1 @member2 @member3 ...
```

筆者の環境ではPullRequestのレビュアーアサインのためだけに使っているため、このような特殊な前提になっています。そのため、CODEOWNERSを真面目に指定している（パスごとに別々のメンバーを指定するなどしている）場合は工夫が必要かと思います。

CODEOWNERSのユーザ指定はアサインのスクリプトと違って`@`がついたメンション指定式のため、それを取り除く処理が入っています。

なお、リポジトリ内のファイルを参照するため `- uses: actions/checkout@v3` のstepが必要です。（それらを含めた全コードは、前述のGitHubのリポジトリのリンク先を参照）

### ランダムに選ぶ
対象者の配列が得られているので、ここから一つランダムチョイスします。

```javascript
const index = Math.floor(Math.random() * names.length)
const assignee = names[index]
```

Rubyでいうところの[`Array#shuffle`](https://docs.ruby-lang.org/ja/latest/method/Array/i/shuffle.html)のようなものが欲しいのですが、JavaScriptではこのようなコードになるようです。0~1の乱数(実数)を生成 -> 候補の個数をかける -> 整数に切り捨て として0~(N-1)のランダム整数を作り、それをindexとして配列から一つ取り出しています。

### アサインする
あとはactions/github-scriptのREADMEやoctokitのドキュメントを参考にしつつアサインを実行します。

```javascript
github.rest.issues.addAssignees({
  issue_number: context.issue.number,
  owner: context.repo.owner,
  repo: context.repo.repo,
  assignees: [assignee]
})
```

なお[`act`](https://github.com/nektos/act)などでランダム部分の動作検証をする場合、一行目を`console.log({`に差し替えるのが楽です。

## shell実装
次にshell実装です。

```yaml
  random-assign:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: |
          echo "$MEMBERS" |
            tail -n +2 |
            shuf -n 1 |
            xargs gh pr edit $NUMBER --add-assignee
        env:
          NUMBER: ${{ github.event.pull_request.number }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          MEMBERS: |
            foo-
            bar-
            baz-
        if: ${{ toJSON(github.event.pull_request.assignees) == '[]' }}
```

`shuf`コマンドにて「入力 (リスト) をランダムに並び替えたものを返す」ことができ、かつ`-n`オプションで返却する要素の個数を指定できるため、これによって候補者リストから一人だけ選んでいます。
そして選んだ結果を`xargs`を使って`gh`コマンドに渡してアサインを実行します。テスト時は`xargs gh ...`を`xargs echo`とすると良い感じです。

なおshellの場合の候補者リストはenv経由のほうが多少楽です。またyaml上ではパイプ記法で候補リストのインデントを揃えたため、値としては一行目が空行になってしまいます。そのため`tail -n +2`で2行目以降に絞っています。

### CODEOWNERS版
こちらのCODEOWNERS版のスクリプトは以下のようになりました。

```shell
head -n 1 .github/CODEOWNERS |
  tr -d '@' |
  sed s/^\*\ // |
  sed s/\ /\\n/g |
  shuf -n 1 |
  xargs gh pr edit $NUMBER --add-assignee
```

JavaScript実装と同じく、1行目を取り出しユーザ名の`@`を取り除き、先頭のファイルパス指定を消し、スペースを区切りにするという前処理が入っています。

## まとめ
インターネット上の記事などを探すと自前のactionを作っているものが多いので、簡単そうに見えて実は面倒なのではないかと心配していましたが、特に何も難しいことはなく実現できました。

shell実装のほうが行数が少なくシンプルですが、特殊なカスタムを入れたい場合やshell芸に抵抗があるチームの場合はJavaScript実装も良いでしょう。
