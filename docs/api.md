# API

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

## Required environment variables

`.env.local` に次の値を設定する。実際のキーはコミットしない。

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```