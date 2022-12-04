const fs = require("fs");
const path = require("path");
const markdownToHtml = require("zenn-markdown-html");
const matter = require("gray-matter");

const outDir = "./preview";

function main() {
  listArticles()
    .filter((article) => !article.published)
    .forEach((article) => {
      const html = buildArticle(article);

      const out = path
        .resolve(outDir, article.filepath)
        .replace(/\.md$/, ".html");
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, html);
    });

  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(
    "./node_modules/zenn-content-css/lib/index.css",
    path.resolve(outDir, "zenn-content-css.css")
  );

  // TODO: プレビューしない記事のものも含めて全コピーしているのを何とかする？
  const imageDir = path.resolve(outDir, "images");
  fs.mkdirSync(imageDir, { recursive: true });
  fs.cpSync("./images", imageDir, { recursive: true });
}

function listArticles() {
  return fs.readdirSync("./articles").map((file) => {
    const filepath = path.relative(__dirname, path.resolve("articles", file));
    const raw = fs.readFileSync(filepath, { encoding: "utf-8" });
    const {
      data: { title, published },
      content,
    } = matter(raw);

    return {
      filepath,
      title,
      published,
      content,
    };
  });
}

function buildArticle({ title, content }) {
  const article = markdownToHtml.default(content);

  return `
<html>
<head>
  <meta name="robots" content="noindex">
  <script src="https://embed.zenn.studio/js/listen-embed-event.js" ></script>
  <link rel="stylesheet" href="../zenn-content-css.css" />
  <style>
    body {
      background-color: #edf2f7;
    }
    header {
      margin-top: 50px;
      height: 100px;
      display: grid;
      place-items: center;
    }
    article {
      max-width: 790px;
      padding: 40px;
      margin: 0 auto;
      border-radius: 12px;
      background-color: white;
    }
  </style>
</head>

<body>
  <header>
    <h1 class="title">${title}</h1>
  </header>
  <main>
    <article class="znc">${article}</article>
  </main>
</body>
</html>
  `;
}

main();
