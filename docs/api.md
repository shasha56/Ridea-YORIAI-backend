# API仕様

## ユーザー登録

`POST /api/auth/register`

メールアドレスとパスワードでSupabase Authユーザーを作成し、同じUUIDで`public.users`にPassengerプロフィールを作成する。認証前に利用するエンドポイントのため、アクセストークンは不要。

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

- 必須: `email`、`password`（8〜72文字）、`user_name`（1〜100文字）
- 任意: `phone_number`、`profile_image_path`、`address_postcode`、`address`
- 現在地を指定する場合、`current_latitude`と`current_longitude`を両方指定する
- `role`は指定できず、常に`passenger`として登録される

### 成功レスポンス

- `201 Created`
- パスワードとメールアドレスはレスポンスに含めない

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

- `400`: JSONとして不正
- `409`: メールアドレスが登録済み
- `422`: 入力値が不正
- `500`: サーバー設定、Supabase Auth、またはプロフィール作成の失敗

エラー形式:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "email must be a valid email address."
  }
}
```

`public.users`の作成に失敗した場合、作成直後のAuthユーザーを削除して不整合を補償する。Service Role Keyはサーバー専用の`SUPABASE_SERVICE_ROLE_KEY`から取得し、クライアントへ返さない。
