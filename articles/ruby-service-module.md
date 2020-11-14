---
title: "Rubyでスッキリとサービスクラス（モジュール）を作る"
emoji: "👻"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [ruby, rails]
published: false
---

Rubyで`Foo.execute(args)`のように使えるクラスを作りたい。インタンス化は必要無い。内部で使うためのメソッドにはアクセスされたくない。
そしてできるだけスッキリ書きたい。

いいやり方ないかなと思っていましたが、ありました。

## 先に結論
定義側で
```ruby:foo_module.rb
module Foo
  extend self

  def execute
    bar
    baz
    ...
  end

  private

  def bar; ...; end
  def baz; ...; end
end
```
呼び出し側で
```ruby
Foo.execute # ok
Foo.bar     # NoMethodError (private method `bar' called for Foo:Module)
Foo.baz     # NoMethodError (private method `baz' called for Foo:Module)
```

参考にしたのは以下です:
https://stackoverflow.com/a/62632216

## これまでの模索

### self.def
```ruby
class Foo
  def self.execute
    bar
  end

  private

  def self.bar; ...; end
end
```
※classでもmoduleでもどっちでも同じです

通常のクラスと同じように区切り線的に`private`を置き、かつ全メソッドを`self.method_name`の形式で書くかたちです。
メソッド定義の頭に`self.`を付けていく必要があとはいえそこまで面倒でなく比較的スッキリしていますが...致命的な問題として**privateが意味ありません**。`Foo.bar`が普通に呼べます。

メンバー内の性善説で「privateより下は外から呼ばない」として運用するのはアリです。
ただし設定によってはrubocopに`private`が怒られるため、その場合はコメントで書くか他の手段で。

### private\_class\_method
```ruby
class Foo
  def self.execute
    bar
  end

  def self.bar; ...; end
  private_class_method :bar
end
```
`private_class_method`します。当然外から`Foo.bar`は呼べません。

極めて正攻法で文法的に正しいのですが、private側のメソッド名を必ず2回書く必要があり面倒です。
また筆者の好みですが「publicなものとprivateなものを`private`という境界線によって視覚的に分離したい」という要求があり、その点が微妙です。

### class \<\< self
```ruby
module Foo
  class << self
    def execute
      bar
    end

    private

    def bar; ...; end
  end
end
```

privateでの区切りが意味をなしており、また`self.`を都度書かなくなって良い、良いのだが...！
ファイルのほぼ全域のインデントが一段増えてしまうのがつらいです。惜しい。

一応、インデントを減らしたいだけであれば
```
module Foo; class << self
  ...
end;end
```
という手もありますが、謎ハック感があってちょっと...

## そして再度結論
冒頭のコードを再掲します。
```ruby
module Foo
  extend self

  def execute
    bar
    baz
    ...
  end

  private

  def bar; ...; end
  def baz; ...; end
end
```

module定義の先頭に簡素に一行`extend self`を入れておくだけで、メソッド定義時に何か特別なことをするでもなく、公開メソッドと非公開メソッドを`private`で区切ったかたちでスッキリと定義できます。変な書き方も無くインデントも増えません。

筆者はRailsでの開発でAPIラッパーやバッチ処理の本体などを書く際にこのかたちにするので、今後活用していけそうです。
やったね！
