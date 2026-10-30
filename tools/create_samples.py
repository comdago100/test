"""python tools/create_samples.py [출력 폴더] — 실행 예제 9개 생성."""
import sys
from pathlib import Path
import pandas as pd


def main():
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else "samples")
    folder.mkdir(parents=True, exist_ok=True)
    for category in ("원재료", "부재료", "제품"):
        for role, qty, price in [("이월", 100, 1000), ("출고" if category == "제품" else "입고", 200, 1000), ("재고", 50, 1000)]:
            data = {"재질": ["SUS304"]} if category == "원재료" else {"품명": [f"{category} 품목 A"], "규격": ["표준"]}
            if category == "제품":
                data = {"공장": ["1공장"], **data}
            if role in ("입고", "출고"):
                data = {"입고일" if role == "입고" else "출고일": ["2022-06-15"], **data}
            data["수량"] = [qty]
            if category != "제품":
                data["단가"] = [price]
            if category != "제품" or role != "출고":
                data["금액"] = [qty * price]
            pd.DataFrame(data).to_excel(folder / f"{category}_{role}.xlsx", index=False)
    print(folder.resolve())


if __name__ == "__main__":
    main()
