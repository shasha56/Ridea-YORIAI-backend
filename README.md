# Ridea Yoriai Backend

React + Viteフロントエンド向けのライドシェアAPIバックエンドです。Next.js App Router、Supabase Auth、Supabase PostgreSQLを使用しています。

## 主な機能

- メールアドレス・パスワードによる登録、ログイン、ログアウト
- Passenger・Driverプロフィールの取得と更新
- Passengerによる予約登録、一覧取得、キャンセル
- DriverによるShiftの登録、一覧取得、変更、キャンセル
- 予約とShiftのマッチング候補抽出
- Supabase Authユーザーを含むテストデータ投入

DB設計は[docs/db-design.md](docs/db-design.md)、詳細なAPI仕様は[docs/api.md](docs/api.md)を参照してください。

## 技術構成

- Next.js 16 App Router / TypeScript
- Supabase Auth / PostgreSQL
- `@supabase/supabase-js`
- npm

## セットアップ

### 1. 依存関係

```bash
npm ci
```

### 2. 環境変数

リポジトリ直下に`.env`を作成します。

```ini
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=your-anon-or-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
MATCHING_CRON_SECRET=replace-with-a-random-secret
SEED_USER_PASSWORD=replace-with-a-test-password
```

| 変数 | 用途 |
| --- | --- |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_ANON_KEY` | ログインとユーザートークンによるAPIアクセス |
| `SUPABASE_SERVICE_ROLE_KEY` | Auth Admin APIとバックエンド内部のDB操作 |
| `MATCHING_CRON_SECRET` | Matching API専用Bearer Secret |
| `SEED_USER_PASSWORD` | seedユーザー共通パスワード（8文字以上） |

Service Role KeyとMatching Secretはサーバー専用です。フロントエンド、`VITE_*`変数、Git管理対象ファイルへ公開しないでください。

### 3. ローカルSupabase

```bash
npx supabase start
npx supabase db reset --local --no-seed
npx supabase status
```

表示されたURLとキーを`.env`へ設定します。

### 4. 開発サーバー

```bash
npm run dev
```

標準のAPI Base URLは`http://localhost:3000`です。

## 認証

ログイン成功時の`session.access_token`を認証必須APIへ送ります。

```http
Authorization: Bearer <access-token>
```

基本フロー：

1. `POST /api/auth/register`で登録
2. `POST /api/auth/login`でアクセストークンとリフレッシュトークンを取得
3. 認証必須APIへアクセストークンを送信
4. `POST /api/auth/logout`後、フロントエンドに保存した両トークンを削除

## API一覧

### Auth

| Method | Path | 認証 | 概要 |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | 不要 | AuthユーザーとPassengerプロフィールを登録 |
| `POST` | `/api/auth/login` | 不要 | メールアドレスとパスワードでログイン |
| `POST` | `/api/auth/logout` | Bearer | 現在のAuthセッションを無効化 |

登録例：

```json
{
  "email": "passenger@example.com",
  "password": "password123",
  "user_name": "山田 太郎",
  "phone_number": "090-1234-5678",
  "profile_image_path": null,
  "address_postcode": "100-0001",
  "address": "東京都千代田区千代田1-1",
  "current_latitude": null,
  "current_longitude": null
}
```

ログイン成功時は`session.access_token`、`session.refresh_token`、有効期限、ユーザーIDを返します。ログアウト成功時は`204 No Content`です。

### Users

| Method | Path | 現在の入力 | 概要 |
| --- | --- | --- | --- |
| `GET` | `/api/users?id=<uuid>` | User UUID | Passengerプロフィールを取得 |
| `PATCH` | `/api/users` | JSON本文の`id` | Passengerプロフィールを更新 |

現在のUsers APIはBearerトークンを検証せず、クライアント指定のユーザーIDを使用しています。本番利用前に、アクセストークンからユーザーIDを取得する方式への修正が必要です。

### Drivers

| Method | Path | 現在の入力 | 概要 |
| --- | --- | --- | --- |
| `GET` | `/api/drivers?id=<driver-id>` | Driver ID | Driverとユーザー情報を取得 |
| `PATCH` | `/api/drivers` | JSON本文の`id` | Driverとユーザー情報を更新 |

現在のDrivers APIもBearerトークンによる本人確認を行っていません。

### Reservations

すべてBearer認証が必要で、ユーザーIDは検証済みアクセストークンから取得します。

| Method | Path | 概要 |
| --- | --- | --- |
| `POST` | `/api/reservations` | 予約を`pending`状態で登録 |
| `GET` | `/api/reservations` | 自身の予約一覧を取得 |
| `DELETE` | `/api/reservations?id=<reservation-id>` | 自身の予約をキャンセル |

予約登録例：

```json
{
  "passenger_count": 2,
  "start_address": "東京駅",
  "start_latitude": 35.681236,
  "start_longitude": 139.767125,
  "end_address": "羽田空港",
  "end_latitude": 35.549393,
  "end_longitude": 139.779839,
  "desired_arrival_at": "2026-10-01T10:00:00+09:00"
}
```

新規予約の受付期限は到着希望日の2日前18:00（Asia/Tokyo）です。キャンセルは`pending`または`accepted`に限り、基準日の前日18:00まで受け付けます。

### Shifts

すべてBearer認証が必要です。認証ユーザーにDriverプロフィールがない場合は`403`を返します。

| Method | Path | 概要 |
| --- | --- | --- |
| `GET` | `/api/shift` | 自身のShift一覧を取得 |
| `POST` | `/api/shift` | 使用車両と勤務時間を登録 |
| `PATCH` | `/api/shift?id=<shift-id>` | `available`な自身のShiftを変更 |
| `DELETE` | `/api/shift?id=<shift-id>` | `available`な自身のShiftをキャンセル |

Shift登録例：

```json
{
  "car_id": 1,
  "start_time": "2026-10-01T09:00:00+09:00",
  "end_time": "2026-10-01T13:00:00+09:00"
}
```

同一Driverまたは同一Carの有効なShiftと時間が重複する場合は`409`を返します。

### Unavailable Shift

| Method | Path | 認証 | 概要 |
| --- | --- | --- | --- |
| `POST` | `/api/shift/unavailable` | Driver Bearer | Driverの対応不可時間を登録 |

現行Migrationでは`shifts.car_id`がNOT NULLで、`unavailable`はstatusの許可値に含まれません。このAPIは現行DBスキーマと非互換です。

### Matching

| Method | Path | 認証 | 概要 |
| --- | --- | --- | --- |
| `POST` | `/api/matching` | Matching Secret | 指定日の未マッチング予約と利用可能Shift候補を抽出 |

```http
POST /api/matching
Authorization: Bearer <MATCHING_CRON_SECRET>
Content-Type: application/json

{
  "date": "2026-10-01"
}
```

現在は候補一覧を返すだけで、ReservationへのShift割り当てやステータス更新は行いません。

## レスポンスとエラー

| Status | 意味 |
| --- | --- |
| `200` | 取得・更新成功 |
| `201` | 新規作成成功 |
| `204` | 本文なしで成功 |
| `400` | JSON、クエリ、入力形式が不正 |
| `401` | 認証情報がない、または無効 |
| `403` | 権限不足 |
| `404` | 対象が存在しない |
| `409` | 期限、状態、時間重複などの競合 |
| `422` | Auth APIの入力検証エラー |
| `500` | サーバー設定または予期しないエラー |

エラー形式はAPIによって`{"error":"message"}`または`{"error":{"code":"CODE","message":"message"}}`です。

## React + Viteからの利用

```ini
VITE_API_BASE_URL=http://localhost:3000
```

```ts
const response = await fetch(
  `${import.meta.env.VITE_API_BASE_URL}/api/reservations`,
  {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  },
);
```

現在CORSヘッダーが明示されているのはUsers APIとDrivers APIだけです。他APIをVite開発サーバーから直接呼ぶ場合は、Viteのproxy設定またはバックエンド側の統一的なCORS対応が必要です。

## Seed

Migration適用後、AuthユーザーとAPI確認用データを投入できます。

```bash
npm run seed
```

書き込まず検証だけを行う場合：

```bash
npm run seed:verify
```

seedは自然キーで既存データを検索するため、同じ環境で再実行してもfixtureが重複しない構成です。本番データを含むProjectでは実行しないでください。

## 検証

```bash
npm run lint
npm run build
npx supabase db lint --local --schema public --level error --fail-on error
```

## 実装上の注意事項

- RLSを有効化し、DB操作はNext.jsバックエンド経由に限定する設計です。
- Service Role Keyを使うAPIでは、アプリケーション側の認証・認可が必須です。
- Users APIとDrivers APIには認証・所有権検証が未実装です。
- Reservations APIとMatching APIは、現行Migrationにない`desired_arrival_at`や`trip_id`を参照しており、DBスキーマとの同期が必要です。
- Unavailable Shift APIは現行Migrationと非互換です。
- Matching APIは候補抽出のみで、割り当て処理は未実装です。
- APIごとにエラー形式とCORS対応が統一されていません。
- Hosted SupabaseへのMigration適用やseed投入は、対象Projectを確認して実行してください。
