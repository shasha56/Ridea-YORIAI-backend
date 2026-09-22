import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);


// ========================================
// GET：ユーザーIDから名前・住所・電話番号を取得
// ========================================
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // URLからユーザーIDを取得
  const userId = searchParams.get("id");

  // ユーザーIDがない場合
  if (!userId) {
    return Response.json(
      { error: "ユーザーIDを入力してください" },
      { status: 400 }
    );
  }

  // Supabaseからユーザー情報を取得
  const { data, error } = await supabase
    .from("users")
    .select("id, user_name, home_address, phone_number")
    .eq("id", userId)
    .single();

  // エラーが発生した場合
  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  // 取得したデータを返す
  return Response.json(data);
}


// ========================================
// POST：名前・住所・電話番号を登録
// ========================================
export async function POST(request: Request) {
  try {
    // フロントから送られてきたデータを取得
    const body = await request.json();

    const {
      id,
      user_name,
      home_address,
      phone_number
    } = body;

    // 入力チェック
    if (!id || !user_name || !home_address || !phone_number) {
      return Response.json(
        { error: "入力されていない項目があります" },
        { status: 400 }
      );
    }

    // Supabaseのusersテーブルに登録
    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          id,
          user_name,
          home_address,
          phone_number
        }
      ])
      .select()
      .single();

    // Supabase側でエラーが発生した場合
    if (error) {
      return Response.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // 登録成功
    return Response.json(
      {
        message: "ユーザー情報を登録しました",
        user: data
      },
      { status: 201 }
    );

  } catch {
    return Response.json(
      { error: "リクエストの処理に失敗しました" },
      { status: 500 }
    );
  }
}