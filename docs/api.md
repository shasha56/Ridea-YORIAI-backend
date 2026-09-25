
# API仕様

## Shift

すべてのShift APIは、Supabase Authのアクセストークンを次の形式で送る。

```http
Authorization: Bearer <access-token>
```

認証済みユーザーに紐づく `drivers` レコードがない場合は `403` を返す。Shiftの時刻はISO 8601形式で受け取り、DBにはUTCのISO文字列として保存する。

### Shift一覧

```http
GET /api/shift
```

認証ユーザー自身のShiftを開始時刻順で返す。レスポンスには `id`、`driver_id`、`car_id`、`start_time`、`end_time`、`status`、`created_at` を含む。

### Shift登録

```http
POST /api/shift
Content-Type: application/json

{
  "car_id": 1,
  "start_time": "2026-09-23T09:00:00+09:00",
  "end_time": "2026-09-23T13:00:00+09:00"
}
```

`car_id` は必須で、同じDriverまたは同じCarに重複する時間帯がある場合は `409` を返す。終了時刻と次の開始時刻が同じ場合は重複と見なさない。

### Shift変更

```http
PATCH /api/shift?id=123
Content-Type: application/json

{
  "car_id": 1,
  "start_time": "2026-09-23T10:00:00+09:00",
  "end_time": "2026-09-23T14:00:00+09:00"
}
```

`available` 状態の本人のShiftだけ変更できる。`booked`、`completed`、`canceled` のShiftは `409` を返す。

### Shift削除（キャンセル）

```http
DELETE /api/shift?id=123
```

物理削除はせず、`available` のShiftを `canceled` に変更する。履歴を保持するためである。予約済みのShiftは、紐づくReservationへの影響を確定させずに削除できないため `409` を返す。

---

## ユーザー登録

`POST /api/auth/register`

メールアドレスとパスワードでSupabase Authユーザーを作成し、同じUUIDで `public.users` にPassengerプロフィールを作成する。認証前に利用するエンドポイントのため、アクセストークンは不要。

### リクエスト

```json
{
  "email": "passenger@example.com",
  "password": "password123",
  "user_name": "山田 太郎",
  "phone_number": "090-1234-5678",
  "profile_image_path": null,
  "address_postcode": "100-0001",
  "address": "東京都千代田区千代田1-1",
  "current_latitude": 35.681236,
  "current_longitude": 139.767125
}
```

- 必須：`email`、`password`（8〜72文字）、`user_name`（1〜100文字）
- 任意：`phone_number`、`profile_image_path`、`address_postcode`、`address`
- 現在地を指定する場合、`current_latitude` と `current_longitude` を両方指定する
- `role` は指定できず、常に `passenger` として登録される

### 成功レスポンス

`201 Created`

パスワードとメールアドレスはレスポンスに含めない。

```json
{
  "user": {
    "id": "00000000-0000-0000-0000-000000000000",
    "user_name": "山田 太郎",
    "phone_number": "090-1234-5678",
    "profile_image_path": null,
    "address_postcode": "100-0001",
    "address": "東京都千代田区千代田1-1",
    "role": "passenger",
    "current_latitude": 35.681236,
    "current_longitude": 139.767125,
    "created_at": "2026-09-24T00:00:00.000Z",
    "updated_at": "2026-09-24T00:00:00.000Z"
  }
}
```

### エラー

- `400`：JSONとして不正
- `409`：メールアドレスが登録済み
- `422`：入力値が不正
- `500`：サーバー設定、Supabase Auth、またはプロフィール作成の失敗

エラー形式：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "email must be a valid email address."
  }
}
```

`public.users` の作成に失敗した場合、作成直後のAuthユーザーを削除して不整合を補償する。

Service Role Keyはサーバー専用の `SUPABASE_SERVICE_ROLE_KEY` から取得し、クライアントへ返さない。

---

## ログイン

`POST /api/auth/login`

メールアドレスとパスワードをSupabase Authで検証し、後続APIのBearer認証とセッション更新に使用するトークンを返す。

### リクエスト

```json
{
  "email": "passenger@example.com",
  "password": "password123"
}
```

### 成功レスポンス

`200 OK`

```json
{
  "session": {
    "access_token": "access-token",
    "refresh_token": "refresh-token",
    "expires_in": 3600,
    "expires_at": 1790222400,
    "token_type": "bearer"
  },
  "user": {
    "id": "00000000-0000-0000-0000-000000000000",
    "email": "passenger@example.com"
  }
}
```

後続APIでは `Authorization: Bearer <access_token>` ヘッダーを指定する。`refresh_token` はアクセストークン更新用としてフロントエンドで安全に管理する。

### エラー

- `400`：JSONとして不正
- `401`：メールアドレスまたはパスワードが不正
- `403`：メールアドレスが未確認
- `422`：入力値が不正
- `500`：サーバー設定またはSupabase Authで予期しないエラーが発生

ログイン処理ではService Role Keyを使用せず、サーバー専用の `SUPABASE_ANON_KEY` を使用する。

---

## 必要な環境変数

`.env.local` に次の値を設定する。実際のキーはコミットしない。

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

`SUPABASE_SERVICE_ROLE_KEY` はサーバー側でのみ使用し、フロントエンドには公開しない。
