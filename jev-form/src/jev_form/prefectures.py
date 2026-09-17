"""47都道府県と8地方のマスタ。

`hint` は Jev の choice criteria にそのまま渡す短い識別子で、モデルへ渡す
判断材料である。地理・気候・名産・主要都市など、ヒント文と突き合わせやすい
語を優先して並べる。
"""

from __future__ import annotations

from dataclasses import dataclass

REGIONS: dict[str, str] = {
    "hokkaido": "北海道地方",
    "tohoku": "東北地方（青森・岩手・宮城・秋田・山形・福島）",
    "kanto": "関東地方（茨城・栃木・群馬・埼玉・千葉・東京・神奈川）",
    "chubu": "中部地方（新潟・富山・石川・福井・山梨・長野・岐阜・静岡・愛知）",
    "kinki": "近畿地方（三重・滋賀・京都・大阪・兵庫・奈良・和歌山）",
    "chugoku": "中国地方（鳥取・島根・岡山・広島・山口）",
    "shikoku": "四国地方（徳島・香川・愛媛・高知）",
    "kyushu": "九州・沖縄地方（福岡・佐賀・長崎・熊本・大分・宮崎・鹿児島・沖縄）",
}


@dataclass(frozen=True)
class Prefecture:
    code: str
    name: str
    region: str
    hint: str


PREFECTURES: tuple[Prefecture, ...] = (
    Prefecture("hokkaido", "北海道", "hokkaido", "日本最北。札幌・函館・旭川、雪まつり、ラベンダー、海産物、広大な農地"),
    Prefecture("aomori", "青森県", "tohoku", "本州最北端。ねぶた祭、りんご、津軽海峡、白神山地、恐山"),
    Prefecture("iwate", "岩手県", "tohoku", "本州で最も広い県。盛岡、わんこそば、平泉中尊寺、三陸海岸"),
    Prefecture("miyagi", "宮城県", "tohoku", "仙台、七夕まつり、牛タン、松島、伊達政宗"),
    Prefecture("akita", "秋田県", "tohoku", "なまはげ、竿燈まつり、きりたんぽ、秋田犬、豪雪地帯"),
    Prefecture("yamagata", "山形県", "tohoku", "さくらんぼ、蔵王の樹氷、最上川、山寺、米沢牛"),
    Prefecture("fukushima", "福島県", "tohoku", "会津若松、猪苗代湖、桃、磐梯山、浜通り・中通り・会津の3地域"),
    Prefecture("ibaraki", "茨城県", "kanto", "水戸、納豆、偕楽園、筑波山、干し芋、霞ヶ浦"),
    Prefecture("tochigi", "栃木県", "kanto", "日光東照宮、宇都宮餃子、いちご、那須高原、中禅寺湖"),
    Prefecture("gunma", "群馬県", "kanto", "草津温泉、伊香保、こんにゃく、上毛かるた、からっ風、海なし県"),
    Prefecture("saitama", "埼玉県", "kanto", "さいたま市、川越の蔵造り、草加せんべい、都心通勤、海なし県"),
    Prefecture("chiba", "千葉県", "kanto", "成田空港、房総半島、落花生、九十九里浜、東京湾アクアライン"),
    Prefecture("tokyo", "東京都", "kanto", "首都、23区、島嶼部（伊豆諸島・小笠原）、人口最多、皇居"),
    Prefecture("kanagawa", "神奈川県", "kanto", "横浜、鎌倉、箱根、川崎、中華街、湘南"),
    Prefecture("niigata", "新潟県", "chubu", "コシヒカリ、日本酒、佐渡島、豪雪、信濃川"),
    Prefecture("toyama", "富山県", "chubu", "立山黒部、富山湾の白えび・ホタルイカ、黒部ダム、くすりの県"),
    Prefecture("ishikawa", "石川県", "chubu", "金沢、兼六園、能登半島、加賀友禅、輪島塗"),
    Prefecture("fukui", "福井県", "chubu", "恐竜博物館、越前がに、東尋坊、永平寺、眼鏡フレーム"),
    Prefecture("yamanashi", "山梨県", "chubu", "富士山北麓、ぶどう・ワイン、桃、富士五湖、甲府盆地、海なし県"),
    Prefecture("nagano", "長野県", "chubu", "日本アルプス、善光寺、軽井沢、そば、りんご、海なし県"),
    Prefecture("gifu", "岐阜県", "chubu", "白川郷、飛騨高山、長良川の鵜飼、関の刃物、海なし県"),
    Prefecture("shizuoka", "静岡県", "chubu", "富士山南麓、茶、うなぎ、浜名湖、駿河湾、伊豆半島"),
    Prefecture("aichi", "愛知県", "chubu", "名古屋、自動車産業、味噌カツ・ひつまぶし、名古屋城、中部国際空港"),
    Prefecture("mie", "三重県", "kinki", "伊勢神宮、真珠の英虞湾、松阪牛、忍者の伊賀、熊野古道"),
    Prefecture("shiga", "滋賀県", "kinki", "琵琶湖、彦根城、比叡山延暦寺、近江牛、海なし県"),
    Prefecture("kyoto", "京都府", "kinki", "古都、寺社、祇園祭、舞妓、天橋立、抹茶"),
    Prefecture("osaka", "大阪府", "kinki", "商業都市、たこ焼き・お好み焼き、通天閣、道頓堀、面積が小さい"),
    Prefecture("hyogo", "兵庫県", "kinki", "神戸、姫路城、有馬温泉、淡路島、日本海と瀬戸内海の両方に面する"),
    Prefecture("nara", "奈良県", "kinki", "大仏、鹿、法隆寺、飛鳥、古代の都、海なし県"),
    Prefecture("wakayama", "和歌山県", "kinki", "高野山、熊野三山、みかん、梅、白浜温泉、紀伊半島南部"),
    Prefecture("tottori", "鳥取県", "chugoku", "鳥取砂丘、二十世紀梨、大山、水木しげるロード、人口最少"),
    Prefecture("shimane", "島根県", "chugoku", "出雲大社、石見銀山、宍道湖、隠岐諸島、神話の国"),
    Prefecture("okayama", "岡山県", "chugoku", "桃太郎、白桃・マスカット、倉敷美観地区、後楽園、晴れの国"),
    Prefecture("hiroshima", "広島県", "chugoku", "原爆ドーム、宮島の厳島神社、お好み焼き、牡蠣、瀬戸内"),
    Prefecture("yamaguchi", "山口県", "chugoku", "ふぐ、秋吉台、関門海峡、萩、錦帯橋、本州最西端"),
    Prefecture("tokushima", "徳島県", "shikoku", "阿波踊り、鳴門の渦潮、すだち、藍染、祖谷のかずら橋"),
    Prefecture("kagawa", "香川県", "shikoku", "讃岐うどん、金刀比羅宮、小豆島、瀬戸大橋、面積が最小"),
    Prefecture("ehime", "愛媛県", "shikoku", "道後温泉、みかん、松山城、しまなみ海道、坊っちゃん"),
    Prefecture("kochi", "高知県", "shikoku", "坂本龍馬、かつおのたたき、四万十川、よさこい、太平洋に面する"),
    Prefecture("fukuoka", "福岡県", "kyushu", "博多、豚骨ラーメン、明太子、屋台、九州の玄関口"),
    Prefecture("saga", "佐賀県", "kyushu", "有田焼・伊万里焼、吉野ヶ里遺跡、佐賀牛、バルーンフェスタ"),
    Prefecture("nagasaki", "長崎県", "kyushu", "出島、ちゃんぽん、教会群、島が多い、平和公園、五島列島"),
    Prefecture("kumamoto", "熊本県", "kyushu", "熊本城、阿蘇山、馬刺し、くまモン、水がきれい"),
    Prefecture("oita", "大分県", "kyushu", "別府温泉、湯布院、関さば、源泉数日本一、地獄めぐり"),
    Prefecture("miyazaki", "宮崎県", "kyushu", "日南海岸、マンゴー、地鶏、高千穂、プロ野球キャンプ、南国"),
    Prefecture("kagoshima", "鹿児島県", "kyushu", "桜島、黒豚、焼酎、屋久島、種子島、西郷隆盛"),
    Prefecture("okinawa", "沖縄県", "kyushu", "亜熱帯、首里城、サンゴ礁、シーサー、島々、本土から最も遠い"),
)

BY_CODE: dict[str, Prefecture] = {p.code: p for p in PREFECTURES}
