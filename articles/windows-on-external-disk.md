---
title: "windowsをusb外付けストレージでちゃんと動かす"
emoji: "⛳"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [windows, 環境構築, OS]
published: false
---

:::message
この記事は2019年11月12日にqiitaに投稿したものの移行記事となります。
元記事はこちら https://qiita.com/cumet04/items/0ce7364901a3b4429b0f
:::

iMac使ってるけどwindows使いたい...けどfusion driveのhdd遅いんだよな...

あれ？usb3.1でSSD挿せば速いんじゃね？やってみるか！
SSDとケース買って、インストールメディア用意して起動して...

「usbドライブにはインストールできません」

( ﾟдﾟ)

### じゃあどうするか
参考サイト:
https://www.tenforums.com/tutorials/84331-apply-windows-image-using-dism-instead-clean-install.html
https://docs.microsoft.com/ja-jp/windows-hardware/manufacture/desktop/bcdboot-command-line-options-techref-di

windowsにはDISM (Deployment Image Servicing and Management) というツールがあり、
これを使うとwindowsインストールメディアの中身をwindowsインストーラを使わずにストレージに展開することができます。

コマンドプロンプトにあるCLIツールなので特にインストール先の制約を受けず、
これを使えばusb外付けのストレージにもwindowsをインストールできますね。

### コマンドプロンプトを開く
windowsのインストールメディアおよびインストールしたいストレージを挿しておき、インストーラを起動します。

なにやらインストールを促すウィンドウが表示されますが、それには目もくれず
おもむろに`Shift+F10`を押せばコマンドプロンプトが出現します。

CLIが出てくればこっちのもんですね。

### ディスクをパーティショニングする
OSのインストールでまずはじめにすることはパーティショニングです。
[ArchLinux](https://wiki.archlinux.jp/index.php/インストールガイド)でも諸々確認後に最初に起こすアクションはパーティショニングですよね。

windowsでのパーティショニングにはDISKPARTを使います。
コマンドプロンプトに`diskpart`と入力すれば専用プロンプトになります。

通常のwindowsのパーティショニングにはルートボリュームの他に回復パーティションなど色々ありますが、
ここでは~~回復パーティションの作り方はわからないので~~シンプルにEFIとルートボリュームのみとします。

`help`や`help コマンド名`とするとある程度ヘルプが表示されるので、それを頼りにパーティショニングしていきます。
実行するコマンドは概ね以下のようになりました。

```
list disk
select disk 3 # インストール先のディスク番号を選択
clean all
convert gpt

create partition efi size=1024 # windowsは標準で100MBのEFIを作った気がしますが、余裕を持って1GBで
select partition 1
format fs=FAT32 quick
list volume
select volume 5 # 作成したEFIパーティションの番号を選択
assign letter=F # 適当に空いてるドライブレターを指定

create partition primary
select partition 2
format fs=NTFS quick
list volume
select volume 6 # 作成したprimaryパーティションの番号を選択
assign letter=G # 適当に空いてるドライブレターを指定
```

※インストール完了後に思い出しながら書いているため、細かいところは間違っている可能性があります。

ポイントは
* ディスクはGPTにしておく ^[2019年なので流石にUEFIでブートします]
* フォーマットしておく
* ドライブレターも忘れず付与しておく

となります。フォーマットを忘れると当然ファイル書き込みできませんし、ドライブレターが無いと書き込み先を指定できません。
（筆者はどちらもエラーになってから気付きました。）

パーティショニングが終わったら`exit`でDISKPARTを終了します。

### windowsイメージを展開する
ここから先はほぼ下記サイトのPart Twoの通りに進めます。
https://www.tenforums.com/tutorials/84331-apply-windows-image-using-dism-instead-clean-install.html

筆者はMedia Creation Toolでインストールメディアを使ったため

```
dism /Get-WimInfo /WimFile:E:\Sources\install.esd
```

というようにしてインストールメディアの詳細を確認しました。
※インストールメディアがE:ドライブにある場合

なお、日本語版WindowsのインストールメディアとUSキーボードの組み合わせの場合はここでバックスラッシュが入力できず詰みそうになりますが、
`X:\Sources>`のバックスラッシュをマウスドラックで選択 -> 右クリック でコピーできます。
これを更に右クリックすればペーストできるので

```
dism /Get-WimInfo /WimFile:E:{右クリック}Sources{右クリック}install.esd
```

というような入力で切り抜けることができます。このときは本当に詰んだかと思いました...

インストールメディアの中身（エディションとインデックスの対応）が確認できれば

```
dism /Apply-Image /ImageFile:E:\Sources\install.esd /index:3 /ApplyDir:G:\
```

というようにしてイメージを展開できます。
上記の場合だと、index=3（自分のメディアではWin10Pro）をG:ドライブに展開です。

### ブートパーティションをセットアップする
windowsイメージを展開しただけではブートできないので、EFIパーティションの中身も展開します。

[ヘルプ](https://docs.microsoft.com/ja-jp/windows-hardware/manufacture/desktop/bcdboot-command-line-options-techref-di)を確認しつつ

```
G:\Windows\System32\bcdboot G:\Windows /s F: /f ALL
```

というようにしてブートファイルを書き込みます。

windowsのファイルもそうですが、`dir F:\`などでファイルが書き込まれていることが確認できます。

### 再起動・インストール続行
以上でコマンド作業は完了なので、コマンドプロンプトを閉じる -> インストーラウィンドウも閉じてマシンを再起動します。

再起動後インストールしたディスクを起動すると、windowsのセットアップ画面（通常インストールの途中からのイメージ）が起動します。
あとは画面に従ってMicrosoftアカウントにログインするなりコルタナをオフにするなりしていけばセットアップ完了です。

### まとめ
一工夫すれば案外windowsも柔軟なインストールができます。

自分のように内蔵ストレージより外付けが速いというケースは稀かもしれませんが、
似たことをやりたい変わり者の参考になれば幸いです。
