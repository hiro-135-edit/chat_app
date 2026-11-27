# ツナガル

## 1. 概要
![ツナガル](assets/tsunagaru.png)
- デモURL（本番環境）：[chatroomblog.com](https://chatroomblog.com/)
- テストアカウント：
  - email: guest1@example.com
  - password: password1234

## 2. 開発背景（なぜ作ったのか）
私は色んな人と話すことが好きで、人と人が気軽につながり、楽しめるコンテンツを作りたいと考えていました。しかし、既存のサービスにはシンプルで使いやすいが、UIが古風（例：4chan）、モダンだが機能が多すぎて初心者には使いづらいもの（例：X、Discord）です。そこで私は、シンプルさとモダンさの中間にあるアプリを作りたいと考え、その構想から生まれたのが「ツナガル」 です。

## 3. 使用技術
### フロントエンド
- React 19.2.3
- Next.js 15.5.9
- TypeScript 5.9.3

#### 認証
- NextAuth 4.24.13

#### UI / デザイン
- Mantine 8.3.12
- Tailwind CSS 3.4.19
- Headless UI 2.2.9
- Tabler Icons 3.36.1
- Framer Motion 12.23.26

#### コード品質
- ESLint 9.39.2
- Prettier

#### テスト
- Jest 30.2.0
- React Testing Library 16.3.2

### バックエンド
- Ruby 3.3.10
- Rails 7.2.3
- PostgreSQL 1.5.9

#### 認証
- Devise 4.9.4
- JWT（devise-jwt 0.12.1）
- OAuth（Google, Facebook）

#### コード品質
- rubocop 1.81.7

#### テスト
- rspec-rails 8.0.2

### インフラ
-  AWS(Route53 / ALB / VPC / ECR / ECS Fargate / RDS PostgreSQL / S3) / Nginx / Vercel

#### CI / CD: GitHub Actions

#### 環境構築: Docker / Docker Compose

## 4. 機能一覧
- ユーザー登録 / ログイン / ログアウト / 削除 /　パスワード変更
- Google・FacebookのOuth機能
- ルーム作成 / 一覧 / 削除
- メッセージ投稿 / 一覧 / 編集 / 削除
- メールアドレス・名前の変更機能 

## 5. ER図
![ER図](assets/ER図.png)

## 6. インフラ構成図
![インフラ構成図](assets/インフラ構成図.jpg)


## 7. 設計整理・リファクタリング（2026-11-26）

既存の画面・API仕様を保ちながら、重複処理、責務の集中、不要な検索を優先して整理しました。ライブラリの追加、DBスキーマの変更、認証方式の変更は行っていません。

### 構成と依存関係

| 層 | 主な場所 | 役割 |
| --- | --- | --- |
| 画面 | `frontend/src/app` | Next.js App Routerによるページ表示、フォーム・メニュー・スクロール |
| チャットの状態管理 | `frontend/src/hooks/useRoomMessages.ts` | メッセージ取得・投稿・編集・削除、入力状態、通知 |
| BFF（フロント専用API） | `frontend/src/app/api/bff` | NextAuthセッションの確認、入力検証、Railsへの中継 |
| BFFの共通通信 | `frontend/src/lib/bff/backend.ts` | 共有トークン付きリクエスト、JSON応答の変換 |
| Rails API | `backend/app/controllers/api` | 共有トークン検証、リソース取得、権限確認、HTTP応答 |
| データ・業務ルール | `backend/app/models` | 関連・入力制約・メッセージ編集期限、PostgreSQLへの保存 |
| インフラ・CI/CD | `nginx`、`docker-compose.yml`、`.github/workflows` | リバースプロキシ、コンテナ、テスト、ECR/ECSへの配信 |

チャットの処理は `RoomChat → useRoomMessages → BFFルート → 共通通信 → Railsコントローラー → モデル → PostgreSQL` の順に進みます。NextAuthの設定は引き続き `frontend/src/lib/nextauth/auth.ts` が担当します。

### 改善内容と採用理由

| 優先度 | 変更前の問題 | 変更後 | 設計原則・効果 |
| --- | --- | --- | --- |
| 高 | Railsの4コントローラーに同じトークン検証が存在 | `Api::BffController` に集約し、Rooms・Messages・Users・Auth::Upsertsが継承 | DRY・単一責任。認証処理の修正箇所を一本化 |
| 高 | メッセージ編集・削除で、取得済みのルームとメッセージを再検索 | `before_action` の `@room`・`@message` を利用し、所有者確認も共有 | DRY・KISS。不要な検索とオブジェクト生成を削減 |
| 高 | 編集期限の判定がモデルとコントローラーに重複 | 既存の `Message#editable_by?` に委譲 | 関心の分離。業務ルールをモデルに集約 |
| 高 | BFF各ルートにRailsのURL・トークン・JSON応答処理が分散 | `fetchBackend`・`backendJsonResponse` を追加。ルーム・メッセージ・確認APIで使用し、パスワードAPIは通信部分を共有 | DRY・関心の分離。ルート固有の認証・入力検証と通信を分離 |
| 中 | 2つのルーム作成エンドポイントに同じPOST実装 | 詳細ルートから一覧ルートのPOSTを再利用 | 既存URLを保ちながら二重修正を解消 |
| 中 | 536行の `RoomChat.tsx` に描画・通信・編集状態が集中 | 描画側319行と専用フック246行に分離 | 単一責任・高凝集。表示と状態遷移をそれぞれ読める構成 |
| 中 | ルーム・メッセージのJSON項目定義、Room型が重複 | JSON定義を各コントローラー内のprivateメソッドへ集約。Room型を `frontend/src/types/room.ts` で共有 | DRY。API項目や型の変更漏れを削減 |
| 中 | 正常系中心のテストで、境界条件・失敗時の挙動が未確認 | API契約、編集期限、所有者確認、UI失敗時の状態、SQL回数をテスト | 保守性。構造変更による回帰を検出 |

継承は共通の認証処理を持つ1階層に限定しました。汎用Repository、DIコンテナ、汎用CRUDサービスなどは導入せず、実際に重複している処理だけを共有しています（KISS・YAGNI）。

### 維持した仕様とDBアクセス

- APIのJSON項目、HTTPステータス、エラーメッセージ、入力検証の順序を維持しました。ログイン・新規登録は従来どおり共有トークン検証の対象外です。
- メッセージは作成時の本文をそのまま保存し、編集時は前後の空白を除去します。編集は作成からちょうど1時間まで可能で、削除には編集期限を適用しません。
- Railsのメッセージ削除は本文なしの204、BFFの削除成功は200と `{ "ok": true }` を維持しました。パスワードAPI固有のエラー応答も変更していません。
- ルーム・メッセージ一覧は既存の `includes(:user)` を維持しました。複数の投稿者がいても投稿者取得が1回のSELECTで済むことをテストしています（N+1：件数に比例して関連データの問い合わせが増える問題への対策）。
- 編集・削除時のルームとメッセージの検索を各2回から各1回へ削減しました。クエリキャッシュを無効にしたテストでは、この2テーブルのSELECTが合計4回から2回になります。通常運用の実SQL回数はキャッシュの影響を受けるため、応答速度の改善率は計測していません。

### メリット・トレードオフ

- メリット：認証・通信・JSON定義の修正箇所が減り、画面と状態管理を別々に追えるため、変更とテストが容易になります。
- トレードオフ：処理を追う際に参照するファイルが増えます。共通通信・認証の変更は複数APIに影響するため、個別ルートの回帰テストと一緒に確認する必要があります。

### 検証結果

| 検証 | 結果 |
| --- | --- |
| フロントエンド Jest | 6スイート・42テスト成功（作業前は13テスト）。同じ42テストを変更前の実装にも適用し成功 |
| バックエンド RSpec | 38テスト成功（作業前は6テスト）。挙動確認の36テストは変更前の実装でも成功 |
| SQL回数の回帰テスト | 変更前は編集・削除の2テストで重複検索を検出、変更後は両方成功 |
| TypeScript | `tsc --noEmit --incremental false` 成功 |
| ESLint | `npm run lint` 成功 |
| Next.js本番ビルド | `npm run build` 成功。検証用のローカルURLを指定して実行 |
| RuboCop | 変更したRubyファイル7件で指摘なし |

RSpecはRuby 3.3.10と、一時ディレクトリに構築したPostgreSQL 14.18で実行しました。Compose・CI指定のPostgreSQL 15、Dockerイメージのビルド、ECS環境、実ブラウザ・外部OAuthを使ったE2Eは今回未検証です。既存DBと既存のカバレッジファイルは変更していません。

テストデータを各テスト終了時に戻す設定を明示し、`COVERAGE_DIR` でカバレッジの出力先を変更できるようにしました。未指定時の出力先は従来どおり `coverage` です。

フロントエンドの再確認：

```bash
cd frontend
npm test -- --runInBand
npx tsc --noEmit --incremental false
npm run lint
npm run build
```

バックエンドの再確認（Ruby 3.3.10と起動済みのテスト用PostgreSQLが必要です。`DATABASE_URL` にはテスト専用DBを指定してください）：

```bash
cd backend
export RAILS_ENV=test
export DATABASE_URL='postgres://TEST_USER:TEST_PASSWORD@127.0.0.1:5432/chatapp_test'
export BFF_SHARED_TOKEN=test-bff-token
export SECRET_KEY_BASE=test-only-secret
export COVERAGE_DIR=/tmp/chatapp-test-coverage
bundle exec rails db:prepare
bundle exec rspec
```

### 全体確認で見つかった別途対応候補

次の項目は動作・運用の判断を伴うため、今回の仕様維持リファクタリングには含めていません。

- `RoomsList` は削除失敗時に処理中状態が解除されず、再試行できない経路があります。失敗時のUI仕様と合わせて修正する候補です。
- `/api/bff/auth/logout` の呼び出しに対応するBFFルートがありません。また、posts・confirm等にはRailsルートとの不整合があります。外部からの利用状況を確認してから整理します。
- OAuthのユーザー更新・作成とIdentity作成が単一トランザクションになっていません。同時ログイン時の扱いを決めたうえで改善する候補です。
- 認証処理には応答本文を記録するデバッグログが残っています。ログに残す項目の整理が必要です。
- ECSデプロイのワークフローはCI成功と独立して起動します。また、Dockerビルドの除外設定とNginxの固定200ヘルスチェックは、配信・監視の方針を確認して見直す候補です。

## 8. テスト補強・カバレッジ計測（2026-11-27）

認証、入力検証、プロフィール、パスワード変更、退会、通信失敗、所有者確認を中心に、フロント135件・Rails95件を追加しました。既存テストは削除・無効化していません。通常順とランダム順（seed: `20261127`）で全件成功しています。

### テスト補強時点の結果と比較

その後のルーム閲覧認証の修正を含めた最新結果は、第10節に記録しています。

| 対象 | 補強前 | 補強後 | 目標 |
| --- | --- | --- | --- |
| フロント行 | 36.72%（336 / 915行） | **85.02%（778 / 915行）** | 80%以上：達成 |
| フロント分岐 | 28.82%（128 / 444分岐） | **79.05%（351 / 444分岐）** | 70%以上：達成 |
| Rails行 | 54.87%（180 / 328行） | **93.02%（240 / 258行）** | 80%以上：達成 |
| Rails分岐 | 未計測 | **92.00%（92 / 100分岐）** | 計測を有効化 |
| フロントテスト | 42件成功 | **177件成功・0件失敗（10スイート）** | 既存テストを維持 |
| Railsテスト | 38件成功 | **133件成功・0件失敗** | 既存テストを維持 |

Railsの改善は、テスト追加だけでは **54.87% → 73.17%（240 / 328行）** です。その後、承認を得て未使用コントローラー3件を削除し、集計対象が328行から258行になったため93.02%になりました。テストによる実行行数の増加と、未使用コード削除の効果を分けて記録しています。

集計はフロントの `src/**/*.{ts,tsx}`（型宣言ファイルを除く）と、SimpleCovのRailsアプリ対象を維持しています。未検証ファイルをカバレッジ設定から除外して数値を上げる変更はしていません。型定義だけの `types/room.ts` には実行対象の命令がありません。

### 追加テストと目的

| テスト | 主な検証目的 |
| --- | --- |
| [AccountForms.test.tsx](frontend/test/setup/__tests__/ui/AccountForms.test.tsx) | ログイン・登録の成否、OAuth開始、プロフィール保存とセッション更新、パスワード入力の組合せ、退会時の再認証、二重送信防止、失敗後の状態 |
| [RoomActions.test.tsx](frontend/test/setup/__tests__/ui/RoomActions.test.tsx) | 未ログイン時の操作制限、投稿の成功・失敗、所有者だけの削除操作、確認・キャンセル、モバイルメニュー、削除失敗時の不具合再現 |
| [nextauth.test.ts](frontend/test/setup/__tests__/api/nextauth.test.ts) | 実際のCredentials/OAuth/JWT/sessionコールバック、IDの正規化、エラーの選択、セッション更新によるID偽装の防止、HTTP失敗 |
| [account-routes.test.ts](frontend/test/setup/__tests__/api/account-routes.test.ts) | 認証・プロフィール・退会BFFのセッション確認、設定不足、不正JSON、送信項目の制限、クライアント指定IDの排除、Rails応答と例外の扱い |
| [account_security_spec.rb](backend/spec/requests/api/account_security_spec.rb) | 登録・ログイン・プロフィール・パスワード・退会・OAuthを実DBで検証。失敗時のデータ保持、重複メール、連鎖削除、他アカウントの保護 |
| [content_security_spec.rb](backend/spec/requests/api/content_security_spec.rb) | ルーム・メッセージの入力境界、存在しないユーザー、所有者以外の削除拒否、親子データの削除範囲 |
| [validation_boundaries_spec.rb](backend/spec/models/validation_boundaries_spec.rb) | パスワードの文字種・長さ、メッセージ長、必須関連、編集権限と編集期限、プロフィール変更時のパスワード保持 |
| [legacy_routes_spec.rb](backend/spec/routing/legacy_routes_spec.rb) | 削除した旧コントローラーへのルートがなく、未提供のAPIが引き続き公開されないこと |

### 適用したテスト技法

- **同値分割**：未入力・空白・有効値・不正形式・既存メール・存在しないユーザーを分けて検証。
- **境界値分析**：パスワード7/8/9文字、メッセージ1/499/500/501文字、編集期限ちょうど1時間と1秒超過を確認。
- **デシジョンテーブル**：セッション有無、現在のパスワード、新旧一致、確認用との一致などの組合せと判定順を確認。
- **状態遷移**：待機→送信中→成功/失敗、編集・キャンセル、確認ダイアログ、失敗後の再試行、セッション更新を確認。
- **命令網羅（C0）・分岐網羅（C1）**：カバレッジで不足を確認し、実際の正常系・異常系から補強。行カバレッジはC0の目安として使用し、完全な命令網羅と同一視していません。
- **条件網羅（C2）**：メール/パスワードの片側欠落、所有者の有無・一致/不一致、期限内/期限切れ等、主要条件がそれぞれ真・偽になるケースを用意。計測ツールは個々の条件網羅率を出さないため、全条件の完全網羅は主張していません。

フロントはHTTP、NextAuthセッション、ナビゲーション、通知の境界をモック化し、Mantine/Headless UIの部品やアプリ側の認証コールバックは実装を使用しています。Railsは実際のPostgreSQLに保存・更新・削除し、モデルやDB操作をモック化していません。OAuth生成パスワードだけは乱数出力を固定し、正常なフローのテストを再現可能にしました。数字のない乱数出力が失敗するケースは別途テストしています。

### 確認して整理した旧コード

以下はコード内の参照、`config/routes.rb`、モデル、Deviseの有効モジュールを確認して削除しました。公開中のAPIルートは変更していません。

- `BoardsController`：ルートも `Board` モデルもなく、呼び出し元が存在しない。
- `Api::ConfirmationsController`：ルートがなく、Userでは `confirmable` が無効で、呼び出している確認メール用メソッドが利用できない。
- `Api::Auth::Social::GoogleLoginsController`：ルートのない仮実装。実際のGoogleログインはNextAuthと `Auth::UpsertsController` が担当。

### 発見した不具合・修正候補

既存仕様をテストのために変更しない制約に従い、次の挙動は修正せず記録しました。不具合の再現テストが成功しても、その機能が安全・正常になったという意味ではありません。

1. **優先度高：OAuth upsertの受信認証がない。** `/api/bff/auth/upsert` は未認証のリクエストもサーバーの共有トークン付きでRailsへ送ります。Railsは一致するメールの既存ユーザーにIdentityを紐付けるため、不正なアカウント紐付けにつながるリスクがあります。BFFの転送挙動とRailsのメール紐付けを別々のテストで再現しました。本番への攻撃検証はしていません。
2. **ルーム削除失敗後に操作不能。** `RoomsList` はHTTPエラー・JSON不正・通信例外後も `busy` が解除されず、再試行とキャンセルができません。3経路で再現しました。
3. **OAuthログインが乱数次第で失敗。** `SecureRandom.base58(16)` は数字を含む保証がありません。数字のない生成値を与えるとUserのパスワード制約に抵触し、OAuth登録が422になります。
4. **不正JSONの扱いが不統一。** ログイン・プロフィールBFFではJSON解析例外が未処理です。登録APIのような400応答にならない経路を確認しました。
5. **パスワード案内の不一致。** UIのエラーメッセージは「6文字以上」ですが、Userの複雑性チェックは8文字以上を要求します。7文字の英数字パスワードは拒否されます。

### 未検証・残る限界

- サーバーコンポーネントのページ取得・リダイレクト、NextAuthライブラリ自体のHTTP処理、外部Google/Xとの実際の往復はE2E未検証です。今回はアプリのコールバック・BFF・フォームを重点対象にしました。
- posts系BFFとHMACヘルパーは呼び出し元・対応Railsルートがなく、統合仕様が未確定のため未検証です。公開されているBFFは勝手に削除していません。
- 通知の表示間隔制御、全エラーメッセージの対応表、ActionCable/Jobの空の基底クラスには未検証箇所があります。
- Railsの一部エラー分岐は、前段の検証で到達できないものや、現在存在しない削除拒否コールバックを前提とするものです。実際には発生しないDB障害を過剰なモックで作って網羅率を上げることはしていません。
- 使用DBは一時環境のPostgreSQL 14.18です。Compose/CI指定の15、実ブラウザ、ECS環境は未検証です。既存DBと既存の未コミット変更・カバレッジファイルは保持しています。

### 再実行・継続チェック

フロントは `npm run test:coverage` で全ソースを集計し、行80%・分岐70%未満なら失敗します。Railsは `bundle exec rspec` で行・分岐を計測し、行80%未満なら失敗します。RailsのLCOVを単一の `lcov.info` に出力する設定も追加し、既存CIが指定するファイル名と一致させました。

```bash
# frontend ディレクトリで実行
npm run test:coverage
npm run test:coverage -- --randomize --seed=20261127
npx tsc --noEmit --incremental false
npm run lint
```

```bash
# backend ディレクトリで実行（テスト専用DATABASE_URL等は前節を参照）
COVERAGE_DIR=/tmp/chatapp-test-coverage bundle exec rspec --order random --seed 20261127
```

今回のフロント計測結果は `/private/tmp/chatapp-coverage-expanded/frontend/coverage-summary.json` と `lcov-report/index.html`、Railsは `/private/tmp/chatapp-coverage-expanded/backend/.last_run.json`・`.resultset.json`・`lcov.info` に出力しました。行/分岐の数値は各ツールの小数点以下表示に合わせています。

### CI・Codecov設定の更新

- [CI](.github/workflows/ci.yml)のフロント実行を `npm run test:coverage -- --ci` に統一しました。Jestの行80%・分岐70%と、SimpleCovのRails行80%の判定をCIでも実行し、Railsの分岐もLCOVに出力します。
- [codecov.yml](codecov.yml)の `frontend`・`backend` のプロジェクト判定を、それぞれ `target: 80%`・`threshold: 0%` に変更しました。全体の `default` 判定（基準コミット比で許容低下1ポイント）と差分判定（80%、許容低下1ポイント）は継続します。行・分岐それぞれの目標はJest/SimpleCovで判定します。設定の意味は[Codecov公式のステータス説明](https://docs.codecov.com/docs/commit-status)を参照してください。
- Codecov Actionに `disable_search: true` を指定し、各ジョブの `coverage/lcov.info` だけを送信します。リポジトリに残る古い分割レポートを自動収集させないためです。テスト失敗時も、キャンセルされておらずレポートが存在すれば送信します。既存の `fail_ci_if_error: false` は維持し、テスト失敗自体はCI失敗として扱います。[Actionの公式入力定義](https://github.com/codecov/codecov-action/blob/v5/action.yml)
- `parsers.lcov.branch_detection` は[公式リファレンス](https://docs.codecov.com/docs/codecovyml-reference#parsers)に定義されていないため削除しました。`branch_detection` はgcov向けの項目で、LCOVの分岐情報はテストツールが出力する `BRDA` レコードに含まれます。
- PostgreSQLサービスの `options: >-` 内にあったコメントを外へ移しました。この位置の `#` はYAMLコメントにならずDockerの引数に混入するためです。

ローカルでYAMLの読み込み、レポートパス・フラグ・目標値・Docker起動引数の整合を確認しました。CIと同じフロントコマンド（出力先のみ一時ディレクトリへ変更）で再実行し、**177件成功・0件失敗、行85.02%・分岐79.05%** でした。結果は `/private/tmp/chatapp-ci-coverage/frontend/` に保存しています。Railsは実行コマンドを変更しておらず、直前の133件成功時の単一LCOVに行258件・分岐100件のレコードが含まれることを確認しました。

GitHub Actions上での実行・Codecovへのアップロードは未確認です。ローカルのNode.jsは20.9.0で、CI指定の24とは異なります。Codecov公式APIによる設定検証は、設定ファイルの外部送信が自動承認レビューで許可されなかったため未実施です。

## 9. ローカル起動・実ブラウザ確認（2026-11-27）

Docker上のPostgreSQL 15・Rails・Nginxと、ホスト上のNext.jsを起動し、**https://localhost:8443/** で実際に操作して確認しました。前節までの「Docker・実ブラウザ未検証」は当時の記録で、今回ローカル環境について追加検証しています。

### 起動方法

Docker Desktopを起動し、既存の環境変数ファイルとmkcertの証明書を用意した状態で実行します。

```bash
# chatappディレクトリで実行
docker compose up -d --build

# 別ターミナルで実行
cd frontend
npm run dev
```

ブラウザで `https://localhost:8443/` を開きます。Next.jsは3000番ポートで起動しますが、アプリ内の認証・API通信は設定済みのHTTPS・8443番ポートを使います。停止時は `docker compose stop` と、Next.jsを起動したターミナルで `Ctrl+C` を使用します。DBボリュームの削除や初期化は不要です。

### 起動時に対応した問題

- `backend/app/channels/application_cable/google_logins_controller.rb` は0バイトの未追跡ファイルで、参照がなく、Railsの自動読み込みで `ApplicationCable::GoogleLoginsController` が見つからず起動が停止していました。ファイルを `/private/tmp/chatapp-live-backup/google_logins_controller.rb` へ退避し、アプリの読み込み対象から外しました。
- NginxはRailsコンテナのネットワークを共有しています。Rails停止後の再起動では、Nginxを `docker compose up -d --force-recreate nginx-proxy` で作り直し、接続を復旧しました。
- 既存DBのマイグレーションは適用済みで、DBのリセットやマイグレーション実行は行っていません。

### 動作確認結果

Chromiumによる実ブラウザ操作と実API・DBを用いた確認で、**14項目成功・0項目失敗**、ブラウザ内の未処理例外0件でした。

- HTTPSでのホーム表示、未認証の投稿と共有トークンなしのRails APIアクセス拒否。
- フォームからの新規登録、ログイン、誤ったパスワードの拒否、ログアウト。
- ルーム作成・一覧表示、メッセージ送信・編集・削除、ルーム削除、再読込後の保存内容。
- 別の検証用アカウントによるルーム削除・メッセージ編集が403で拒否されること。
- プロフィールとセッションの更新、パスワード変更、変更後のメール・パスワードでの再ログイン、退会とセッション終了。
- PC・モバイル幅の画面表示、モバイルメニューの開閉。

検証用アカウントと投稿は削除しました。既存データの件数は前後ともユーザー3件・ルーム5件・メッセージ30件です。検証ツールは一時ディレクトリに導入し、プロジェクトの依存関係は追加していません。

実行記録と画面画像は `/private/tmp/chatapp-live-browser/`、Next.jsのログは `/private/tmp/chatapp-live-frontend.log` に保存しています。HTTPS証明書はmkcertのCAを指定したcurlで検証し、ブラウザ自動操作ではローカル証明書のエラーを許容しています。

ログアウト・退会の途中で `/api/bff/auth/logout` が404を返す既知の不整合を再確認しました。NextAuth側のセッション終了は成功しています。Google/Xの外部OAuthと本番ECS環境は今回も未検証です。

## 10. ルーム閲覧時の認証修正（2026-11-27）

未ログインでもホイールクリックでルーム画面を別タブに開ける問題を修正しました。原因は通常クリック時の画面側チェックだけで、ルームページと詳細APIにセッション確認がなかったことです。修正前には実ブラウザで別タブ表示と直接アクセスを再現し、画面・詳細APIが200、メッセージAPIは401で応答することを確認しました。

### 変更内容

- ルームページは、データ取得前にサーバーでセッションとユーザーIDを確認します。未ログインではホームへ戻るため、URL直接入力・別タブ・JavaScript無効時も保護されます。
- `GET /api/bff/rooms/:roomId` もセッションとユーザーIDを必須にし、未認証ならRailsへ問い合わせず401を返します。一覧表示は引き続き公開します。
- 認証後のサーバーページは共通通信ヘルパーでRailsから詳細を取得します。取得失敗や不正JSONを表示対象なしとして扱う従来の挙動も維持しました。
- ホイールクリックにも既存のログイン案内を適用し、未ログインでの新規タブへの遷移を止めます。ログイン済みのホイールクリックと、ブラウザの右クリックメニューは利用できます。

### 検証結果

回帰テストを14件追加し、以前の「詳細APIを未認証で取得できる」というテストは、今回の認証要件に合わせて更新しました。既存テストの削除・無効化はしていません。

| 検証 | 結果 |
| --- | --- |
| フロント全テスト | **191件成功・0件失敗（11スイート）** |
| フロント行カバレッジ | 85.02% → **86.47%（799 / 924行）** |
| フロント分岐カバレッジ | 79.05% → **80.44%（362 / 450分岐）** |
| TypeScript・ESLint | 成功 |
| 実ブラウザ確認 | **13項目成功・0項目失敗** |

追加テストでは、未認証・ユーザーID欠落・空IDの拒否、認証前にデータを取得しないこと、認証後の表示、取得失敗、不正JSON、ホイールクリック時の認証状態と右クリックの維持を確認しました。

実ブラウザでは、通常・ホイール・修飾キー付きクリック・Enter操作、別タブ、URL直接入力、JavaScript無効、認証後の閲覧、セッション消失後の再拒否を検証しました。macOSのCtrlクリックは右クリックメニュー相当として確認しています。既存テストアカウントで閲覧だけを行い、DBデータは変更していません。

最新カバレッジは `/private/tmp/chatapp-room-access-coverage/`、実ブラウザの結果は `/private/tmp/chatapp-live-browser/room-access-results.json` に保存しています。起動中のローカルアプリにも反映済みです。
