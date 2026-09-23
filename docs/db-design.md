# DB設計

## 概要

Supabase PostgreSQLを使用するライドシェアWebアプリの暫定DB設計である。認証情報はSupabase Authの`auth.users`が管理し、アプリケーション固有の情報は`public.users`に保存する。バックエンドはSupabase JavaScript ClientからDBを利用し、現時点ではORMを使用しない。

住所はフロントエンドで受け取り、バックエンドでGeocoding APIにより緯度・経度へ変換する。DBには検索・マッチングに使う緯度・経度に加えて、入力された住所も保存する。住所文字列を残すことで、予約内容の再表示やGeocoding結果の確認ができるためである。特定のGeocodingサービスには依存しない。

---

## エンティティ

### auth.users（Supabase Auth管理）

メールアドレス、パスワード認証に必要な情報、ユーザーUUIDなどをSupabase Authが管理する。

### users

`auth.users`と1:1で対応するアプリケーションユーザー情報を管理する。全ユーザーはPassengerとして予約でき、Driverとして利用するユーザーは`role = 'driver'`かつ`drivers`レコードを持つ。DriverでもPassenger機能を利用できる。現在地は参考情報として保存するが、現在のマッチング条件では使用しない。

### drivers

Driverだけが持つ情報を管理する。1ユーザーにつき最大1件とし、勤務可能時間や予約可能枠は`shifts`で管理する。

### cars

ライドシェアで使用する車両と最大乗車人数を管理する。残り乗車可能人数は保存せず、Shiftに紐づく有効なReservationの`passenger_count`合計から都度計算する。車両を利用できるかどうかは、Shiftの状態と時間帯の重複チェックで管理する。

### shifts

Driverの勤務可能時間枠と、そのShiftで使用する車両を管理する。

1 Shiftには複数のReservationを割り当てることができる。相乗り可能なReservationは同一Shiftへ追加で割り当て、Shiftで使用する車両の`car_capacity`を超えない範囲で複数のPassengerグループを乗車させる。

同一DriverのShift時間帯の重複、および同一CarのShift時間帯の重複は禁止する。

### reservations

Passengerの1回の乗車予約を管理する。

Reservation作成時は、まず同一乗車地点・同一降車地点・同一乗車日時で既にReservationが割り当てられているShiftを優先して検索し、残席があれば同じShiftへ追加マッチングする。

相乗り可能な既存Shiftがない場合は、条件を満たす未使用のShiftへ新しい乗車として割り当てる。

Driver自身がPassengerとして作成した予約も同じ構造で扱う。

---

## テーブル定義

### users

| カラム | 型 | 制約・説明 |
| --- | --- | --- |
| `id` | `uuid` | PK、`auth.users.id`へのFK、NOT NULL。Authユーザーと1:1で対応 |
| `user_name` | `text` | NOT NULL |
| `email` | `text` | NOT NULL、`auth.users.email`と同じ値を保存する |
| `phone_number` | `text` | NULL可、電話番号 |
| `profile_image_path` | `text` | NULL可、プロフィール画像のパス |
| `address_postcode` | `text` | NULL可、郵便番号 |
| `address` | `text` | NULL可、住所 |
| `role` | `text` | NOT NULL、DEFAULT `'passenger'`、`passenger`または`driver`のみ |
| `current_latitude` | `numeric` | NULL可、ユーザーの現在地緯度 |
| `current_longitude` | `numeric` | NULL可、ユーザーの現在地経度 |
| `created_at` | `timestamptz` | NOT NULL、作成日時 |
| `updated_at` | `timestamptz` | NOT NULL、現在地情報更新日時 |

`role`はPostgreSQLのCHECK制約で`role IN ('passenger', 'driver')`を保証する。Admin Roleは設けない。現在地は未取得または未更新の場合があるためNULLを許可する。`auth.users`の削除時にユーザー情報も削除する場合は、FKに`ON DELETE CASCADE`を設定する。

### drivers

| カラム | 型 | 制約・説明 |
| --- | --- | --- |
| `id` | `integer` | PK |
| `user_id` | `uuid` | NOT NULL、`users.id`へのFK、UNIQUE |
| `driver_license_image_path` | `text` | NOT NULL、運転免許証の画像パス |
| `created_at` | `timestamptz` | NOT NULL、作成日時 |

`user_id`のUNIQUE制約により、1ユーザーにつきDriver情報は最大1件である。勤務可能状態はShiftの`status`で表現する。

### cars

| カラム | 型 | 制約・説明 |
| --- | --- | --- |
| `id` | `integer` | PK |
| `car_name` | `text` | NOT NULL |
| `car_number` | `text` | NOT NULL、UNIQUE |
| `car_capacity` | `integer` | NOT NULL、車両の最大乗車人数 |
| `created_at` | `timestamptz` | NOT NULL、作成日時 |

`remaining_capacity`は保存しない。

残り乗車可能人数は、Shiftに紐づく`accepted`または`in_progress`のReservationについて`passenger_count`を合計し、次の式で都度算出する。

```text
remaining_capacity =
    car.car_capacity
    - SUM(active_reservation.passenger_count)
```

ここで`active_reservation`は`status IN ('accepted', 'in_progress')`のReservationを指す。

今回の1予約あたりの乗車人数は1〜3人とし、予約時の`passenger_count`で管理する。

### shifts

| カラム | 型 | 制約・説明 |
| --- | --- | --- |
| `id` | `integer` | PK |
| `driver_id` | `integer` | NOT NULL、`drivers.id`へのFK |
| `start_time` | `timestamptz` | NOT NULL |
| `end_time` | `timestamptz` | NOT NULL、`start_time < end_time` |
| `status` | `text` | NOT NULL、DEFAULT `'available'`、状態CHECK |
| `car_id` | `integer` | NOT NULL、`cars.id`へのFK、使用する車 |
| `earnings` | `numeric` | NULL可、乗車完了後に計算される合計運賃 |
| `created_at` | `timestamptz` | NOT NULL、作成日時 |

`status`は`available`、`completed`、`canceled`のいずれかとする。

- `available`: 有効なShift。Reservationが0件の場合も複数件割り当て済みの場合もあり得る
- `completed`: そのShiftに紐づく乗車が完了している
- `canceled`: Driverによって取り消されたShift

旧`booked` statusは完全に廃止する。

Shiftが満席かどうかは`status`では表現せず、`car_capacity`と紐づく有効Reservationの`passenger_count`合計から判定する。

`earnings`は乗車完了後に計算される合計運賃であり、キャンセル時はNULLのままにする。

### reservations

| カラム | 型 | 制約・説明 |
| --- | --- | --- |
| `id` | `integer` | PK |
| `user_id` | `uuid` | NOT NULL、予約したPassengerの`users.id`へのFK |
| `driver_id` | `integer` | NULL可、マッチングされた`drivers.id`へのFK |
| `shift_id` | `integer` | NULL可、割り当てられた`shifts.id`へのFK |
| `status` | `text` | NOT NULL、DEFAULT `'pending'`、状態CHECK |
| `passenger_count` | `integer` | NOT NULL、乗車人数、1〜3のCHECK |
| `start_address` | `text` | NOT NULL、入力された乗車住所 |
| `start_latitude` | `numeric` | NOT NULL、Geocoding後の乗車地点緯度 |
| `start_longitude` | `numeric` | NOT NULL、Geocoding後の乗車地点経度 |
| `end_address` | `text` | NOT NULL、入力された降車住所 |
| `end_latitude` | `numeric` | NOT NULL、Geocoding後の降車地点緯度 |
| `end_longitude` | `numeric` | NOT NULL、Geocoding後の降車地点経度 |
| `scheduled_pickup_at` | `timestamptz` | NOT NULL、Passengerが希望する乗車日時 |
| `fare` | `numeric` | NULL可、乗車完了後に計算される運賃 |
| `created_at` | `timestamptz` | NOT NULL、作成日時 |
| `updated_at` | `timestamptz` | NOT NULL、予約情報更新日時 |

`driver_id`と`shift_id`は、未マッチングの`pending`予約ではNULLである。

同じShiftには複数のReservationを紐づけることができるため、`shift_id`にはUNIQUE制約や部分一意インデックスを設定しない。

Passengerが予約をキャンセルした場合は、`status`だけを`canceled`に変更し、`driver_id`と`shift_id`は履歴として保持する。

`canceled` Reservationの`passenger_count`は使用座席数の計算対象から除外されるため、キャンセルによって空いた座席は別Reservationのマッチングに再利用できる。

---

## ステータス

### Reservation status

- `pending`: 予約は作成されたが、Shift / Driverが確保されていない
- `accepted`: Shift / Driverとの自動マッチングが成立している
- `in_progress`: 乗車中
- `completed`: 乗車完了
- `canceled`: Passengerによるキャンセル、または期限超過によるキャンセル

Driverによる承認操作は行わない。マッチング成立時に`pending`から`accepted`へ自動遷移する。

### Shift status

- `available`: 有効なShift
- `completed`: そのShiftに紐づく乗車が完了している
- `canceled`: Driverによって取り消されたShift

`booked`は使用しない。

Shiftが満席でも`status`は`available`のままとし、追加マッチング可否は残席計算で判断する。

---

## マッチングルール

Reservation作成時、まず以下の条件で相乗り可能な既存Shiftを検索する。

### 1. 既存の相乗り候補を優先

候補Shiftは次の条件を満たす必要がある。

```text
shift.status = 'available'

AND shift.start_time <= reservation.scheduled_pickup_at
AND reservation.scheduled_pickup_at < shift.end_time

AND existing_reservation.status IN ('accepted', 'in_progress')

AND existing_reservation.start_latitude
    = new_reservation.start_latitude
AND existing_reservation.start_longitude
    = new_reservation.start_longitude

AND existing_reservation.end_latitude
    = new_reservation.end_latitude
AND existing_reservation.end_longitude
    = new_reservation.end_longitude

AND existing_reservation.scheduled_pickup_at
    = new_reservation.scheduled_pickup_at
```

現時点では乗車地点・降車地点の緯度経度を完全一致で比較する。

時間についても`scheduled_pickup_at`の完全一致を条件とする。

余裕がある場合は将来的に次の改善を検討する。

- 緯度経度について一定距離以内を同一地点として扱う
- `scheduled_pickup_at`について±5分以内を同一便として扱う

### 2. 残席確認

候補Shiftごとに、使用中の乗車人数を計算する。

```text
occupied_capacity =
    SUM(
        reservations.passenger_count
        WHERE reservations.shift_id = shift.id
        AND reservations.status IN ('accepted', 'in_progress')
    )
```

残席は保存せず、次の式で算出する。

```text
remaining_capacity =
    car.car_capacity - occupied_capacity
```

新規Reservationについて、

```text
new_reservation.passenger_count <= remaining_capacity
```

を満たすShiftのみ候補とする。

1件のReservationを複数の車両やShiftへ分割しない。

例えば3人予約に対して残席が2人の場合、そのShiftは候補外とする。

### 3. 既存相乗りShiftへの割り当て

条件を満たす既存相乗りShiftがある場合は、新規の未使用Shiftより優先して割り当てる。

同一優先度の候補が複数存在する場合は、その候補群からランダムに1件選択する。

成立時は次のように更新する。

```text
reservation.driver_id = shift.driver_id
reservation.shift_id = shift.id
reservation.status = 'accepted'
```

Shiftの`status`は変更しない。

### 4. 新規Shiftへの割り当て

相乗り可能な既存Shiftが存在しない場合、次の条件を満たす未使用Shiftを検索する。

```text
shift.status = 'available'

AND shift.start_time <= reservation.scheduled_pickup_at
AND reservation.scheduled_pickup_at < shift.end_time

AND shiftにaccepted / in_progress Reservationが存在しない

AND reservation.passenger_count <= car.car_capacity
```

候補が複数存在する場合はランダムに1件選択する。

成立時は次のように更新する。

```text
reservation.driver_id = shift.driver_id
reservation.shift_id = shift.id
reservation.status = 'accepted'
```

### 5. 候補がない場合

相乗り可能な既存Shiftも、新しい乗車に使用できるShiftも存在しない場合は次の状態とする。

```text
reservation.driver_id = NULL
reservation.shift_id = NULL
reservation.status = 'pending'
```

`pending` Reservationは、後から新規登録されたShiftや将来の再マッチング処理で再度マッチング対象とする。

予約期限は`scheduled_pickup_at`から算出し、専用カラムは保存しない。

希望乗車日の前日18:00を過ぎた新規予約は受け付けず、期限を過ぎた`pending` Reservationは`canceled`にする。

---

## Shiftの制約

### 複数Reservation

1 Shiftには複数のReservationを割り当てることができる。

ただし、`accepted`または`in_progress` Reservationの乗車人数合計が、そのShiftで使用する車両の`car_capacity`を超えてはいけない。

```text
SUM(
    reservation.passenger_count
    WHERE reservation.shift_id = shift.id
    AND reservation.status IN ('accepted', 'in_progress')
)
<= car.car_capacity
```

この制約は複数行・複数テーブルにまたがるため、通常のCHECK制約ではなく、マッチング処理のトランザクション内で保証する。

### キャンセルによる座席再利用

`accepted` Reservationが`canceled`になった場合、そのReservationの`passenger_count`は使用座席数から除外する。

これにより空いた座席は別のReservationのマッチングに再利用できる。

`driver_id`と`shift_id`は履歴として保持する。

### Shift時間の重複

同一Driverについて、時間帯が重複するShiftは禁止する。

判定条件は次の通り。

```text
existing.start_time < new.end_time
AND new.start_time < existing.end_time
```

終了時刻と次の開始時刻が一致する場合は許可する。

```text
09:00 - 10:00
10:00 - 11:00
```

は重複しない。

ハッカソンではShift登録時にアプリケーション側で同一Driverの既存Shiftを検索して検証する。

DBで完全に保証するExclude Constraint（GiST）は今回は導入しない。

### Car時間の重複

同一Carについても、時間帯が重複するShiftは禁止する。

判定条件はDriverの場合と同じとする。

```text
existing.start_time < new.end_time
AND new.start_time < existing.end_time
```

Shift登録時にアプリケーション側で、同じ`car_id`を使用する既存Shiftとの時間重複を検証する。

---

## 競合対策

複数のReservationが同時に同じShiftの残席へマッチングし、車両定員を超えることを防ぐ必要がある。

マッチング処理は1トランザクションで実行する。

概念的には次の順番とする。

```text
1. 候補Shiftを検索
2. 対象Shiftを行ロック
3. accepted / in_progress Reservationのpassenger_countをSUM
4. car_capacityからremaining_capacityを計算
5. 新規Reservationが収容可能か再確認
6. Reservationへdriver_id / shift_idを設定
7. Reservation.statusをacceptedへ変更
8. COMMIT
```

行ロックには`SELECT ... FOR UPDATE`または`FOR UPDATE SKIP LOCKED`などを利用する構成を想定する。

旧設計の「1 Shift = 最大1 Reservation」を保証する部分一意インデックスは使用しない。

新設計では、同じShiftへ複数Reservationが紐づくことが正常である。

車両定員の超過防止は、Shiftをロックした状態で使用座席数を再計算することによって保証する。

具体的なSupabase RPC / PostgreSQL Functionの実装は別途決定する。

---

## DBで保証するもの / アプリケーション側で保証するもの

### DBで保証するもの

- PK、FK、NOT NULL
- `users.role`の許可値
- `drivers.user_id`のUNIQUE制約
- `cars.car_number`のUNIQUE制約
- `passenger_count`が1〜3であること
- Shiftの`start_time < end_time`
- ReservationとShiftのstatus許可値
- 各テーブル間の参照整合性

### アプリケーション側で保証するもの

- Driver Roleのユーザーだけが`drivers`レコードを持つこと
- Shift登録時の同一Driverの時間重複チェック
- Shift登録時の同一Carの時間重複チェック
- Reservation受付期限（希望乗車日の前日18:00）
- 期限超過した`pending` Reservationの`canceled`への遷移
- ReservationとShiftのstatus遷移
- PassengerによるReservationキャンセル
- Geocoding APIの呼び出しと住所から緯度・経度への変換
- 相乗り可能な既存Shiftを新規Shiftより優先すること
- 乗車地点・降車地点の一致判定
- `scheduled_pickup_at`の一致判定
- Shiftごとの使用座席数計算
- `SUM(passenger_count) <= car_capacity`の保証
- 1件のReservationを複数Shiftへ分割しないこと
- キャンセル後の空席再利用
- 同一優先度候補からのランダム選択
- Authユーザーとプロフィールの作成・更新フロー

---

## ER図

```mermaid
erDiagram

    AUTH_USERS ||--|| USERS : "auth.users.id = users.id"
    USERS ||--o| DRIVERS : "1:0..1"
    USERS ||--o{ RESERVATIONS : "1:N"
    DRIVERS ||--o{ SHIFTS : "1:N"
    DRIVERS ||--o{ RESERVATIONS : "1:N"
    CARS ||--o{ SHIFTS : "1:N"
    SHIFTS ||--o{ RESERVATIONS : "1:N"

    AUTH_USERS {
        uuid id PK
        string email
        string password_auth_data
    }

    USERS {
        uuid id PK, FK
        string user_name NOT NULL
        string email NOT NULL
        string phone_number
        string profile_image_path
        string address_postcode
        string address
        string role NOT NULL
        decimal current_latitude
        decimal current_longitude
        datetime created_at NOT NULL
        datetime updated_at NOT NULL
    }

    DRIVERS {
        integer id PK
        uuid user_id FK, UNIQUE, NOT NULL
        string driver_license_image_path NOT NULL
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
        integer car_id FK, NOT NULL
        decimal earnings
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
        decimal fare
        datetime created_at NOT NULL
        datetime updated_at NOT NULL
    }
```

ER図の`AUTH_USERS`はSupabaseが管理する`auth.users`を表す。`users.id`は別の連番ではなく、`auth.users.id`をそのまま参照するUUIDである。

`users.current_latitude`と`users.current_longitude`は現在地の保存用であり、マッチングには使用しない。

`CARS`と`SHIFTS`は1対多であり、同じCarを時間帯の異なる複数Shiftで利用できる。ただし同一時間帯で同じCarを複数Shiftに割り当てることは禁止する。

`SHIFTS`と`RESERVATIONS`も1対多であり、車両定員を超えない範囲で複数Reservationを同じShiftへ割り当てることができる。

---

## 変更まとめ

- **`remaining_capacity`**: DBには保存せず、`car_capacity - SUM(active reservations.passenger_count)`で都度計算する
- **ShiftとReservation**: `1 Shift = 1 Reservation`を廃止し、`1 Shift : N Reservations`へ変更
- **Shift `booked` status**: 完全廃止
- **相乗り条件**: 乗車地点・降車地点の緯度経度と`scheduled_pickup_at`の完全一致
- **将来の改善候補**: 地点の誤差許容、乗車日時±5分
- **マッチング優先順位**: 既に同一経路のReservationが存在するShiftを優先
- **残席計算対象**: `accepted`、`in_progress`
- **キャンセル**: 使用座席数から除外し、空いた席を再利用
- **予約分割**: 行わない
- **Shift重複**: 同一Driverだけでなく同一Carの時間重複も禁止
- **旧部分一意インデックス**: 廃止
- **競合対策**: Shiftをロックしたトランザクション内で残席を再計算して定員超過を防止

---

## まだ未確定な設計事項

- 実際に使用するGeocoding API
- マッチング処理を実装するSupabase RPC / PostgreSQL Functionの具体形
- タイムゾーン運用
- Shift・Reservationのstatus遷移をどこまでDBトリガーで補助するか
- 緯度経度一致判定を将来どの程度の距離まで許容するか
- `scheduled_pickup_at`の±5分許容を導入するか
