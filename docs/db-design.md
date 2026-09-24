# DB設計

## 概要

Supabase PostgreSQLを使用するライドシェアWebアプリの暫定DB設計である。認証情報はSupabase Authの`auth.users`が管理し、アプリケーション固有の情報は`public.users`に保存する。バックエンドはSupabase JavaScript ClientからDBを利用し、現時点ではORMを使用しない。

住所はフロントエンドで受け取り、バックエンドでGeocoding APIにより緯度・経度へ変換する。DBには検索・マッチングに使う緯度・経度に加えて、入力された住所も保存する。住所文字列を残すことで、予約内容の再表示やGeocoding結果の確認ができるためである。特定のGeocodingサービスには依存しない。

日時は`timestamptz`で保存する。業務上の日付・時刻は日本時間（`Asia/Tokyo`）で判定する。

日時は`timestamptz`で保存する。業務上の日付・時刻は日本時間（`Asia/Tokyo`）で判定する。

## エンティティ

### auth.users（Supabase Auth管理）

メールアドレス、パスワード認証に必要な情報、ユーザーUUIDなどをSupabase Authが管理する。アプリケーション側でパスワードやメールアドレスを`public.users`に重複保存しない。

### users

`auth.users`と1:1で対応するアプリケーションユーザー情報を管理する。全ユーザーはPassengerとして予約できる。Driverは`role = 'driver'`かつ`drivers`レコードを持つ。昇格時は`role`を`passenger`から`driver`へ変更し、`drivers`レコードを同一トランザクション内で作成する。DriverでもPassenger機能を利用できる。現在地はマッチングには使用しない。

### drivers

Driverだけが持つ情報を管理する。1ユーザーにつき最大1件とし、勤務可能時間と使用車両は`shifts`で管理する。

### cars

ライドシェアで使用する車両と最大乗車人数を管理する。車両はDriverへ固定せず、Shiftごとに使用車両を選択する。

### shifts

Driverの勤務時間帯と使用車両を管理する。1 Shiftには、乗車場所・降車場所・希望乗車日時が一致する複数のReservationを、車両定員以内で割り当てられる。同一Driverおよび同一CarのShift時間帯の重複は禁止する。

### reservations

Passengerの1回の乗車予約を管理する。Reservationは最大1件のShiftに割り当てる。Driverは`shift_id`から取得できるため`driver_id`は保存しない。同一便に残席があれば未使用Shiftより優先する。Driver自身の予約も同じ構造で扱う。

## テーブル定義

### users

| カラム              | 型            | 制約・説明                                                    |
| ------------------- | ------------- | ------------------------------------------------------------- |
| `id`                | `uuid`        | PK、`auth.users.id`へのFK、NOT NULL。Authユーザーと1:1で対応  |
| `user_name`         | `text`        | NOT NULL                                                      |
| `phone_number`      | `text`        | NULL可、電話番号                                              |
| `profile_image_path` | `text`       | NULL可、プロフィール画像のパス                                |
| `address_postcode`  | `text`        | NULL可、郵便番号                                              |
| `address`           | `text`        | NULL可、住所                                                  |
| `role`              | `text`        | NOT NULL、DEFAULT`'passenger'`、`passenger`または`driver`のみ |
| `current_latitude`  | `numeric`     | NULL可、ユーザーの現在地緯度                                  |
| `current_longitude` | `numeric`     | NULL可、ユーザーの現在地経度                                  |
| `created_at`        | `timestamptz` | NOT NULL、作成日時                                            |
| `updated_at`        | `timestamptz` | NOT NULL、更新日時                                            |

`role`はPostgreSQLのCHECK制約で`role IN ('passenger', 'driver')`を保証する。Admin Roleは設けない。現在地は未取得または未更新の場合があるためNULLを許可する。`auth.users`の削除時にユーザー情報も削除する場合は、FKに`ON DELETE CASCADE`を設定する。

### drivers

| カラム       | 型            | 制約・説明                         |
| ------------ | ------------- | ---------------------------------- |
| `id`         | `integer`     | PK                                 |
| `user_id`    | `uuid`        | NOT NULL、`users.id`へのFK、UNIQUE |
| `driver_license_image_path` | `text` | NOT NULL、運転免許証画像のパス |
| `created_at` | `timestamptz` | NOT NULL、作成日時                 |

`user_id`のUNIQUE制約により、1ユーザーにつきDriver情報は最大1件である。`is_working`は削除し、勤務可能状態はShiftの`status`で表現する。

### cars

| カラム         | 型            | 制約・説明                   |
| -------------- | ------------- | ---------------------------- |
| `id`           | `integer`     | PK                           |
| `car_name`     | `text`        | NOT NULL                     |
| `car_number`   | `text`        | NOT NULL、UNIQUE             |
| `car_capacity` | `integer` | NOT NULL、2以上のCHECK、Driverを含む車両の総定員 |
| `created_at`   | `timestamptz` | NOT NULL、作成日時           |

`remaining_capacity`は保存しない。`car_capacity`はDriverを含む総定員であるため、Passenger用定員は`car_capacity - 1`とする。残席は、Passenger用定員から、そのShiftに紐づく`accepted`または`in_progress`の`passenger_count`合計を引いて都度算出する。1予約の乗車人数は1〜3人とする。

### shifts

| カラム       | 型            | 制約・説明                                |
| ------------ | ------------- | ----------------------------------------- |
| `id`         | `integer`     | PK                                        |
| `driver_id`  | `integer`     | NOT NULL、`drivers.id`へのFK              |
| `car_id`     | `integer`     | NOT NULL、`cars.id`へのFK、使用する車両   |
| `start_time` | `timestamptz` | NOT NULL                                  |
| `end_time`   | `timestamptz` | NOT NULL、`start_time < end_time`         |
| `status`     | `text`        | NOT NULL、DEFAULT`'available'`、状態CHECK |
| `earnings`   | `numeric`     | NULL可、Shift完了時に確定する合計運賃、CHECK (`earnings IS NULL OR earnings >= 0`) |
| `created_at` | `timestamptz` | NOT NULL、作成日時                        |

`status`は`available`、`booked`、`completed`、`canceled`のいずれかとする。`available`は有効なReservationがない未使用Shift、`booked`は1件以上の有効なReservationがあるShiftを表す。`booked`でも残席があれば同一便を追加できる。満席かどうかは残席計算で判定する。`completed`は乗車完了、`canceled`はDriverが取り消したShiftを表す。`earnings`はShift完了時に、そのShiftに紐づく完了済みReservationの`fare`合計を保存する。完了前およびキャンセル時はNULLとする。

### reservations

| カラム                | 型            | 制約・説明                                    |
| --------------------- | ------------- | --------------------------------------------- |
| `id`                  | `integer`     | PK                                            |
| `user_id`             | `uuid`        | NOT NULL、予約したPassengerの`users.id`へのFK |
| `shift_id`            | `integer`     | NULL可、割り当てられた`shifts.id`へのFK       |
| `status`              | `text`        | NOT NULL、DEFAULT`'pending'`、状態CHECK       |
| `passenger_count`     | `integer`     | NOT NULL、1〜3のCHECK                         |
| `start_address`       | `text`        | NOT NULL、入力された乗車住所                  |
| `start_latitude`      | `numeric`     | NOT NULL、Geocoding後の乗車地点緯度           |
| `start_longitude`     | `numeric`     | NOT NULL、Geocoding後の乗車地点経度           |
| `end_address`         | `text`        | NOT NULL、入力された降車住所                  |
| `end_latitude`        | `numeric`     | NOT NULL、Geocoding後の降車地点緯度           |
| `end_longitude`       | `numeric`     | NOT NULL、Geocoding後の降車地点経度           |
| `scheduled_pickup_at` | `timestamptz` | NOT NULL、Passengerが希望する乗車日時         |
| `fare`                | `numeric`     | NULL可、乗車完了時に確定する運賃、CHECK (`fare IS NULL OR fare >= 0`) |
| `created_at`          | `timestamptz` | NOT NULL、作成日時                            |
| `updated_at`          | `timestamptz` | NOT NULL、更新日時                            |

未マッチングの`pending`予約では`shift_id`をNULLとする。Driverは`shifts.driver_id`から取得する。複数予約を許可するため`shift_id`にUNIQUE制約は設定しない。予約締切前にPassengerが割り当て済み予約をキャンセルした場合も、別Shiftへ再マッチングするため`pending`へ戻して`shift_id`をNULLにする。Shiftキャンセル時も同様に処理する。以前の割り当て履歴は保存しない。

## ステータスと遷移

### Reservation status

- `pending`: Shiftが確保されていない
- `accepted`: Shiftとの自動マッチングが成立
- `in_progress`: 乗車中
- `completed`: 乗車完了
- `canceled`: 予約締切を過ぎてもマッチングできなかったため受付終了

```text
pending -> accepted -> in_progress -> completed
pending -> canceled
accepted -> pending
```

予約締切前にPassengerが予約の割り当てをキャンセルした場合、またはDriverがShiftをキャンセルした場合は、再マッチングのため`accepted -> pending`とし、`shift_id`をNULLにする。DriverはReservationを直接承認・キャンセルしないが、乗車開始前の自身のShiftはキャンセルできる。`in_progress`のReservationまたはそのShiftはキャンセルできない。

### Shift status

- `available`: 有効なReservationがない未使用Shift
- `booked`: 1件以上の有効なReservationがあるShift。残席があれば同一便を追加可能
- `completed`: 乗車完了
- `canceled`: Driverによって取り消されたShift

```text
available -> booked -> completed
available -> canceled
booked -> canceled
booked -> available
```

`booked -> available`は、再マッチングによって有効なReservationが0件になった場合に行う。Shiftのキャンセルと、紐づく`accepted` Reservationを`pending`へ戻す処理は同一トランザクションで行う。Driverの完了操作は設けず、`scheduled_pickup_at`で対象Reservationを`in_progress`へ、Shiftの`end_time`経過後に対象ReservationとShiftを`completed`へ自動遷移させる。同じ自動処理で各Reservationの`fare`を確定し、その合計をShiftの`earnings`へ保存する。

## マッチングルール

Reservation作成時は、相乗り可能な既存便を未使用Shiftより優先する。

### 既存便への追加

次の条件をすべて満たす`booked` Shiftを候補とする。

```text
shift.start_time <= new_reservation.scheduled_pickup_at
AND new_reservation.scheduled_pickup_at < shift.end_time
AND existing_reservation.status IN ('accepted', 'in_progress')
AND existing_reservation.start_latitude = new_reservation.start_latitude
AND existing_reservation.start_longitude = new_reservation.start_longitude
AND existing_reservation.end_latitude = new_reservation.end_latitude
AND existing_reservation.end_longitude = new_reservation.end_longitude
AND existing_reservation.scheduled_pickup_at = new_reservation.scheduled_pickup_at
```

さらに、次を満たす必要がある。

```text
occupied_capacity = SUM(
  reservation.passenger_count
  WHERE reservation.shift_id = shift.id
  AND reservation.status IN ('accepted', 'in_progress')
)

new_reservation.passenger_count
  <= (car.car_capacity - 1) - occupied_capacity
```

1件のReservationは分割しない。同条件の候補が複数あればランダムに1件選ぶ。

### 未使用Shiftへの割り当て

既存便に候補がない場合、次を満たす`available` Shiftからランダムに1件選ぶ。

```text
shift.status = 'available'
AND shift.start_time <= reservation.scheduled_pickup_at
AND reservation.scheduled_pickup_at < shift.end_time
AND reservation.passenger_count <= car.car_capacity - 1
```

成立時はReservationを`accepted`、Shiftを`booked`にする。候補がなければ`shift_id = NULL`、`status = 'pending'`とする。`pending`は後から再マッチングできる。

予約・再マッチング期限は日本時間で算出する。希望乗車日の前日18:00（`Asia/Tokyo`）を過ぎた新規予約および割り当てキャンセルは受け付けない。期限時点の`pending`予約は自動的に`canceled`にする。

## Shiftの制約

### 定員

`car_capacity`はDriverを含む総定員とする。同一Shiftの`accepted`または`in_progress` Reservationの乗車人数合計は`car_capacity - 1`以下でなければならない。この条件はマッチング処理のトランザクション内で保証する。`cars.car_capacity`には`CHECK (car_capacity >= 2)`を設定する。再マッチングのためShiftを離れたReservationの座席は再利用できる。

### 時間の重複

同一Driver、または同一Carを使用するShiftについて、時間帯の重複を禁止する。

```text
(
  existing.driver_id = new.driver_id
  OR existing.car_id = new.car_id
)
AND existing.start_time < new.end_time
AND new.start_time < existing.end_time
```

終了時刻と次の開始時刻が一致する場合は許可する。今回はShift登録時にアプリケーション側で検証し、Exclude Constraint（GiST）は導入しない。`canceled` Shiftを重複判定から除外するかは未確定であり、Initial Migration作成前に決定する。

## 競合対策

マッチングは1トランザクションで実行する。

```text
1. 候補Shiftを検索
2. Shiftを行ロック
3. 使用座席数と同一便条件を再確認
4. Reservationへshift_idを設定してacceptedへ変更
5. 未使用Shiftならbookedへ変更
6. COMMIT
```

`SELECT ... FOR UPDATE`または`FOR UPDATE SKIP LOCKED`を想定する。ShiftキャンセルもShiftをロックし、Shiftの状態変更と対象Reservationの`pending`化を同一トランザクションで行う。

## DBで保証するもの / アプリケーション側で保証するもの

### DBで保証するもの

- PK、FK、NOT NULL、Roleとstatusの許可値
- `drivers.user_id`と`cars.car_number`のUNIQUE制約
- `car_capacity >= 2`、`passenger_count`が1〜3
- `CHECK (fare IS NULL OR fare >= 0)`
- `CHECK (earnings IS NULL OR earnings >= 0)`
- Shiftの`start_time < end_time`
- テーブル間の参照整合性

### アプリケーションおよびRPCで保証するもの

- Driver昇格時の`role`変更と`drivers`作成を同一トランザクションで行うこと
- Driver Roleのユーザーだけが`drivers`レコードを持つこと
- 同一Driver・同一CarのShift時間重複禁止
- Reservation受付期限と期限超過処理
- ReservationとShiftのstatus遷移
- 締切前のPassengerによる割り当てキャンセルと、乗車開始前のDriverによる自身のShiftキャンセル
- 予約またはShiftキャンセル時の再マッチング化
- `scheduled_pickup_at`および`end_time`に基づくstatusの自動遷移
- 乗車完了時の`fare`計算と`earnings = SUM(fare)`の保存
- Geocodingと、緯度・経度・希望乗車日時の完全一致による同一便判定
- 既存便の優先、定員確認、ランダム選択
- 1件のReservationを分割しないこと

## ER図

```mermaid
erDiagram
    AUTH_USERS ||--|| USERS : "auth.users.id = users.id"
    USERS ||--o| DRIVERS : "1:0..1"
    USERS ||--o{ RESERVATIONS : "1:N"
    DRIVERS ||--o{ SHIFTS : "1:N"
    CARS ||--o{ SHIFTS : "1:N"
    SHIFTS ||--o{ RESERVATIONS : "1:N"

    AUTH_USERS { uuid id PK }
    USERS { uuid id PK, FK
            string user_name
            string phone_number
            string profile_image_path
            string address_postcode
            string address
            string role
            decimal current_latitude
            decimal current_longitude
            datetime created_at
            datetime updated_at }
    DRIVERS { integer id PK
              uuid user_id FK, UNIQUE
              string driver_license_image_path
              datetime created_at }
    CARS { integer id PK
           string car_name
           string car_number UNIQUE
           integer car_capacity
           datetime created_at }
    SHIFTS { integer id PK
             integer driver_id FK
             integer car_id FK
             datetime start_time
             datetime end_time
             string status
             decimal earnings
             datetime created_at }
    RESERVATIONS { integer id PK
                   uuid user_id FK
                   integer shift_id FK
                   string status
                   integer passenger_count
                   string start_address
                   decimal start_latitude
                   decimal start_longitude
                   string end_address
                   decimal end_latitude
                   decimal end_longitude
                   datetime scheduled_pickup_at
                   decimal fare
                   datetime created_at
                   datetime updated_at }
```

## まだ未確定な設計事項

- 実際に使用するGeocoding API
- Supabase RPC / PostgreSQL Functionの具体形
- status遷移をどこまでDBトリガーで補助するか
- `canceled` Shiftを時間重複チェックの対象から除外するか
