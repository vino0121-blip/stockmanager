# Cloudflare Pages デプロイ手順

## 1. ログイン

```powershell
$env:PATH="C:\Users\administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;$env:PATH"
.\node_modules\.bin\wrangler.cmd login
```

ブラウザでCloudflareにログインして許可します。

## 2. ビルド

```powershell
$env:PATH="C:\Users\administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;$env:PATH"
.\node_modules\.bin\wrangler.cmd pages deploy dist --project-name trading-card-speed-inventory
```

通常は先に以下を実行します。

```powershell
$env:PATH="C:\Users\administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;$env:PATH"
.\node_modules\.bin\tsc.cmd -b
.\node_modules\.bin\vite.cmd build
```

## 公開後

- Cloudflare Pagesの公開URLをAdSenseの「サイト」に追加します。
- `contact@example.com` は本番用メールアドレスに差し替えてください。
