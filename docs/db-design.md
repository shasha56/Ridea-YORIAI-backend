# DB設計

## 概要

Supabase PostgreSQLを使用するライドシェアWebアプリの暫定DB設計である。認証情報はSupabase Authの`auth.users`が管理し、アプリケーション固有の情報は`public.users`に保存する。バックエンドはSupabase JavaScript ClientからDBを利用し、現時点ではORMを使用しない。

住所はフロントエンドで受け取り、バックエンドでGeocoding APIにより緯度・経度へ変換する。DBには検索・マッチングに使う緯度・経度に加えて、入力された住所も保存する。住所文字列を残すことで、予約内容の再表示やGeocoding結果の確認ができるためである。特定のGeocodingサービスには依存しない。

## エンティティ

### auth.users（Supabase Auth管理）

メールアドレス、パスワード認証に必要な情報、ユーザーUUIDなどをSupabase Authが管理する。アプリケーション側でパスワードやメールアドレスを`public.users`に重複保存しない。

### users

`auth.users`と1:1で対応するアプリケーションユーザー情報を管理する。全ユーザーはPassengerとして予約でき、Driverとして利用するユーザーは`role = 'driver'`かつ`drivers`レコードを持つ。DriverでもPassenger機能を利用できる。現在地は参考情報として保存するが、現在のマッチング条件では使用しない。

### drivers

Driverだけが持つ情報を管理する。1ユーザーにつき最大1件とし、勤務可能時間や予約可能枠は`shifts`で管理する。

### cars

ライドシェアで使用する車両と最大乗車人数を管理する。`is_available`はShiftの状態と重複するため保持しない。車両を利用できるかどうかは、車両の登録状態やDriver・Shiftの運用で管理する。

### shifts

Driverが1件の予約を受け付けることができる勤務可能時間枠を管理する。1 Shiftは最大1 Reservationに割り当てる。同じDriverが同日に複数件受け付ける場合は、予約枠ごとに複数のShiftを登録する。

### reservations

Passengerの1回の乗車予約を管理する。作成時に条件を満たす`available`なShiftを最大1件ランダムに割り当てる。Driver自身がPassengerとして作成した予約も同じ構造で扱う。

## テーブル定義

### users

| カラム              | 型            | 制約・説明                                                    |
| ------------------- | ------------- | ------------------------------------------------------------- |
| `id`                | `uuid`        | PK、`auth.users.id`へのFK、NOT NULL。Authユーザーと1:1で対応  |
| `user_name`         | `text`        | NOT NULL                                                      |
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
| `car_id`     | `integer`     | NOT NULL、`cars.id`へのFK、UNIQUE  |
| `created_at` | `timestamptz` | NOT NULL、作成日時                 |

`user_id`のUNIQUE制約により、1ユーザーにつきDriver情報は最大1件である。`is_working`は削除し、勤務可能状態はShiftの`status`で表現する。

### cars

| カラム         | 型            | 制約・説明                   |
| -------------- | ------------- | ---------------------------- |
| `id`           | `integer`     | PK                           |
| `car_name`     | `text`        | NOT NULL                     |
| `car_number`   | `text`        | NOT NULL、UNIQUE             |
| `car_capacity` | `integer`     | NOT NULL、車両の最大乗車人数 |
| `created_at`   | `timestamptz` | NOT NULL、作成日時           |

`remaining_capacity`は保存しない。今回の1予約あたりの乗車人数は1〜3人とし、予約時の`passenger_count`で管理する。`is_available`は削除する。Shift自体が予約可能枠であり、車両の可用性を別フラグで二重管理する必要がないためである。

### shifts

| カラム       | 型            | 制約・説明                                |
| ------------ | ------------- | ----------------------------------------- |
| `id`         | `integer`     | PK                                        |
| `driver_id`  | `integer`     | NOT NULL、`drivers.id`へのFK              |
| `start_time` | `timestamptz` | NOT NULL                                  |
| `end_time`   | `timestamptz` | NOT NULL、`start_time < end_time`         |
| `status`     | `text`        | NOT NULL、DEFAULT`'available'`、状態CHECK |
| `created_at` | `timestamptz` | NOT NULL、作成日時                        |

`status`は`available`、`booked`、`completed`、`canceled`のいずれかとする。`available`は予約可能、`booked`はReservationが1件割り当て済み、`completed`は乗車完了、`canceled`はDriverが取り消したShiftを表す。

### reservations

| カラム                | 型            | 制約・説明                                    |
| --------------------- | ------------- | --------------------------------------------- |
| `id`                  | `integer`     | PK                                            |
| `user_id`             | `uuid`        | NOT NULL、予約したPassengerの`users.id`へのFK |
| `driver_id`           | `integer`     | NULL可、マッチングされた`drivers.id`へのFK    |
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
| `created_at`          | `timestamptz` | NOT NULL、作成日時                            |
| `updated_at`          | `timestamptz` | NOT NULL、更新日時                            |

`driver_id`と`shift_id`は、未マッチングの`pending`予約ではNULLである。キャンセル時は`status`だけを`canceled`に変更し、`driver_id`と`shift_id`は保持する。これによりマッチング履歴を残しつつ、Shiftは再び`available`にできる。過去のキャンセル予約が同じShiftに複数存在し得るため、`shift_id`の全件UNIQUEではなく、キャンセル以外の予約に対する部分一意インデックスを使用する。

## ステータス

### Reservation status

- `pending`: 予約は作成されたが、Shift / Driverが確保されていない
- `accepted`: Shift / Driverとの自動マッチングが成立している
- `in_progress`: 乗車中
- `completed`: 乗車完了
- `canceled`: Passengerによるキャンセル、または期限超過によるキャンセル

Driverによる承認・キャンセル操作は行わない。マッチング成立時に`pending`から`accepted`へ自動遷移する。

### Shift status

- `available`: 予約可能
- `booked`: Reservationが1件割り当てられている
- `completed`: そのShiftに紐づく乗車が完了している
- `canceled`: Driverによって取り消されたShift

`scheduled`、`on_duty`、`off_duty`は使用しない。

## マッチングルール

Reservation作成時、`scheduled_pickup_at`を含むShiftのうち、次の条件をすべて満たすものを候補とする。

```text
shift.start_time <= reservation.scheduled_pickup_at
AND reservation.scheduled_pickup_at < shift.end_time
AND shift.status = 'available'
```

候補からランダムに1件のShiftを選び、そのShiftの`driver_id`をReservationへ設定する。成立時は次の更新を同一トランザクションで行う。

```text
reservation.driver_id = shift.driver_id
reservation.shift_id = shift.id
reservation.status = 'accepted'
shift.status = 'booked'
```

候補がない場合は`driver_id`と`shift_id`をNULL、`status`を`pending`とする。`pending`予約は、後から新規登録されたShiftや将来の定期処理で再マッチングできる。予約期限は`scheduled_pickup_at`から算出し、専用カラムは保存しない。希望乗車日の前日18:00を過ぎた新規予約は受け付けず、期限を過ぎた`pending`予約は`canceled`にする。

## Shiftの制約

### 1 Shift = 最大1 Reservation

1つのShiftに対して、キャンセルされていないReservationは最大1件とする。DBでは次の部分一意インデックスで同時に複数の予約へ割り当てられることを防ぐ。

```sql
CREATE UNIQUE INDEX reservations_active_shift_unique
ON reservations (shift_id)
WHERE shift_id IS NOT NULL AND status <> 'canceled';
```

Passengerが`accepted`予約をキャンセルした場合は、Reservationの`driver_id`と`shift_id`を履歴として保持し、Reservationを`canceled`、Shiftを`available`へ更新する。このとき部分一意インデックスが解放されるため、Shiftを再利用できる。

### Shift時間の重複

同一Driverについて、時間帯が重複するShiftは禁止する。判定は次の条件とし、終了時刻と次の開始時刻が一致する場合は許可する。

```text
existing.start_time < new.end_time
AND new.start_time < existing.end_time
```

ハッカソンでは、Shift登録時にアプリケーション側で同一Driverの既存Shiftを検索して検証する。DBで完全に保証するExclude Constraint（GiST）も可能だが、追加拡張や運用が必要になるため今回は導入しない。DBでは`start_time < end_time`と状態・外部キーを保証する。

## 競合対策

マッチング処理は、候補Shiftの取得、Shiftの確保、Reservationへの割り当て、Shiftの`booked`更新を1トランザクションで実行する。SupabaseのRPCからPostgreSQL関数を呼び出す構成を想定する。

候補Shiftを行ロック（`SELECT ... FOR UPDATE SKIP LOCKED`など）してから`status = 'booked'`へ変更し、Reservationを更新する。さらに部分一意インデックスを最後のDB側の防波堤とする。具体的なRPCやAPI実装は今回の設計対象外である。

## DBで保証するもの / アプリケーション側で保証するもの

### DBで保証するもの

- PK、FK、NOT NULL、`users.role`の許可値
- `drivers.user_id`と`drivers.car_id`のUNIQUE制約
- `passenger_count`が1〜3であること
- Shiftの`start_time < end_time`
- ReservationとShiftのstatus許可値
- キャンセル以外のReservationが1 Shiftに最大1件であること
- マッチング処理での最終的な一意性（部分一意インデックス）

### アプリケーション側で保証するもの

- Driver Roleのユーザーだけが`drivers`レコードを持つこと
- Shift登録時の同一Driverの時間重複チェック
- Reservation受付期限（希望乗車日の前日18:00）
- 期限超過した`pending`予約の`canceled`への遷移
- ReservationとShiftのstatus遷移、Passengerだけが行うキャンセル
- Geocoding APIの呼び出しと住所から緯度・経度への変換
- マッチング候補からランダムに1件を選ぶ処理
- `passenger_count <= car_capacity`の確認
- Authユーザーとプロフィールの作成・更新フロー

## ER図

```mermaid
erDiagram

    AUTH_USERS ||--|| USERS : "auth.users.id = users.id"
    USERS ||--o| DRIVERS : "1:0..1"
    USERS ||--o{ RESERVATIONS : "1:N"
    DRIVERS ||--o{ SHIFTS : "1:N"
    DRIVERS ||--o{ RESERVATIONS : "1:N"
    CARS ||--o| DRIVERS : "0..1:1"
    SHIFTS ||--o{ RESERVATIONS : "1:0..N (canceled history)"

    AUTH_USERS {
        uuid id PK
        string email
        string password_auth_data
    }

    USERS {
        uuid id PK, FK
        string user_name NOT NULL
        string role NOT NULL
        decimal current_latitude
        decimal current_longitude
        datetime created_at NOT NULL
        datetime updated_at NOT NULL
    }

    DRIVERS {
        integer id PK
        uuid user_id FK, UNIQUE, NOT NULL
        integer car_id FK, UNIQUE, NOT NULL
        datetime created_at NOT NULL
    }

    CARS {
        integer id PK
        string car_name NOT NULL
        string car_number UNIQUE, NOT NULL
        integer car_capacity NOT NULL
        datetime created_at NOT NULL
    }

    SHIFTS {
        integer id PK
        integer driver_id FK, NOT NULL
        datetime start_time NOT NULL
        datetime end_time NOT NULL
        string status NOT NULL
        datetime created_at NOT NULL
    }

    RESERVATIONS {
        integer id PK
        uuid user_id FK, NOT NULL
        integer driver_id FK
        integer shift_id FK
        string status NOT NULL
        integer passenger_count NOT NULL
        string start_address NOT NULL
        decimal start_latitude NOT NULL
        decimal start_longitude NOT NULL
        string end_address NOT NULL
        decimal end_latitude NOT NULL
        decimal end_longitude NOT NULL
        datetime scheduled_pickup_at NOT NULL
        datetime created_at NOT NULL
        datetime updated_at NOT NULL
    }
```

ER図の`AUTH_USERS`はSupabaseが管理する`auth.users`を表す。`users.id`は別の連番ではなく、`auth.users.id`をそのまま参照するUUIDである。`users.current_latitude`と`users.current_longitude`は現在地の保存用であり、現行のShiftマッチングには使用しない。`SHIFTS`と`RESERVATIONS`はキャンセル履歴を含めると1対多に見えるが、キャンセルされていないReservationに限れば1 Shiftにつき最大1件である。

## 変更まとめ

- **削除した項目**: 認証情報に相当する項目、`is_driver`、`drivers.is_working`、`cars.is_available`、旧Shift status（`scheduled`、`on_duty`、`off_duty`）
- **追加した項目**: `users.current_latitude`、`users.current_longitude`、`users.role`、`users.updated_at`、`reservations.shift_id`、`passenger_count`、`start_address`、`end_address`、`reservations.updated_at`、各statusのCHECK制約とShift割り当て用部分一意インデックス
- **名前を変更した項目**: アプリケーション側ユーザー情報のテーブル名を`users`へ統一。`users.id`は`auth.users.id`を参照するUUIDとした。予約日時は`scheduled_pickup_at`を使用し、旧設計の曖昧な`start_time`はShiftの時間範囲に限定
- **主な設計変更**: Supabase AuthとusersをUUIDで1:1に関連付け、現在地をusersに保存（マッチングには不使用）、DriverとPassengerをRoleで整理、Shiftを1件の予約枠として扱い、Shiftをランダムに自動マッチングする
- **DB制約で保証するもの**: PK / FK / NOT NULL、Roleとstatusの許可値、Driverと車両の一意性、乗車人数1〜3、Shift時間の前後関係、1 Shiftへの非キャンセルReservationの最大1件
- **アプリケーション側で保証するもの**: Shift時間帯の重複禁止、予約期限、期限処理、権限とstatus遷移、Geocoding、ランダム選択、乗車人数と車両定員の整合性
- **まだ未確定な設計事項**: 実際のGeocoding API、トランザクション／RPCの具体的実装、タイムゾーン運用、Shift・Reservationのstatus遷移をどこまでDBトリガーで補助するか
