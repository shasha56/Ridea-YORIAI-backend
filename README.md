# Ridea Yoriai Backend

Next.jsとSupabase PostgreSQLを使用するライドシェアAPIバックエンドです。

## セットアップ

```bash
npm ci
cp .env.example .env
```

`.env`へ次の値を設定してください。

| 変数 | 用途 |
| --- | --- |
| `SUPABASE_URL` | ローカルまたはHosted SupabaseのProject URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Auth Admin APIとRLS保護テーブルを操作するサーバー専用キー |
| `SEED_USER_PASSWORD` | 全seedユーザー共通のテスト用パスワード（8文字以上） |

`SUPABASE_SERVICE_ROLE_KEY`はブラウザへ公開せず、`NEXT_PUBLIC_*`変数にも設定しないでください。`.env`はGit管理対象外です。

## ローカルSupabase

`supabase/config.toml`がない場合は、最初に初期化します。

```bash
npx supabase init
npx supabase start
npx supabase db reset --local --no-seed
```

AuthユーザーをAdmin API経由で作成するため、Migration適用後にNode.js seedを実行します。ローカル用のURLとService Role Keyは次のコマンドで確認できます。

```bash
npx supabase status
```

表示された値を`.env`へ設定した後、seedを実行してください。

```bash
npm run seed
```

## Hosted Supabase

CodexはHosted Supabaseへの接続・変更を行いません。実行者が対象Projectを確認し、Migration適用済みであることを確認してから`.env`へHosted ProjectのURLとService Role Keyを設定し、明示的に実行してください。

```bash
npm run seed
```

seedはメールアドレスや各テーブルの自然キーで既存データを検索し、既存行は更新します。同じ環境で再実行してもfixtureは重複しません。本番データを含むProjectでは実行しないでください。

## Seedデータ

共通パスワードは`SEED_USER_PASSWORD`です。

| 種別 | メールアドレス |
| --- | --- |
| Driver | `driver.a@example.test` |
| Driver | `driver.b@example.test` |
| Passenger | `passenger.a@example.test` |
| Passenger | `passenger.b@example.test` |
| Passenger | `passenger.c@example.test` |
| Passenger | `passenger.d@example.test` |

次のシナリオを作成します。

- 同じ乗降地点・乗車日時で、2件の`accepted` Reservationが1件の`booked` Shiftを共有
- 残席を超える人数で再マッチングを待つ`pending` Reservation
- 未使用の`available` Shift
- 有効Shiftと時間が重複していても許可される`canceled` Shift
- `in_progress` Reservationを持ち、キャンセル不可を確認できるShift
- `fare`と`earnings`が設定された完了済みReservation／Shift
- Driver自身がPassengerとして乗車するReservation

## Seedの検証

`npm run seed`は投入後に自動検証します。書き込みせず再検証だけを行う場合は次を実行します。

```bash
npm run seed:verify
```

検証内容：

- 6件のSupabase Authユーザーと`public.users`の対応
- 2台の車両
- `available`、`booked`、`completed`、`canceled`の各Shift
- 同一Shiftに割り当てられた相乗りReservationと乗車人数合計
- `shift_id = NULL`の再マッチング待ちReservation
- 完了済みShiftの`earnings`

追加のローカル検証：

```bash
npx supabase db lint --local --schema public --level error --fail-on error
npm run lint
npm run build
```

## 注意事項

- 最新Migrationでは5テーブルのRLSが有効で、`anon`と`authenticated`からの直接DB操作は禁止されています。
- DB操作は、認証・認可を実施したNext.jsバックエンドからService Role Keyを使って行います。
- 現在の`src/app/api/users/route.ts`はAnon Keyと旧`home_address`カラムを使用しているため、最新DB設計とは非互換です。後続タスクで修正が必要です。
