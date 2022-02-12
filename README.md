# Zenn Contents
https://zenn.dev/cumet04

### snippets

#### new article
```
npx zenn new:article --slug hoge-slug
```

#### preview server
```
npx zenn preview
```

#### to git timestamp
```
ls -1 articles/*.md | while read LINE; touch -d (git log -1 --format=%cI $LINE) $LINE; end
ls -1tr articles/*.md | while read LINE; chmod -x $LINE; sleep 0.1; end
```
