import argparse
import calendar
import csv
import json
from datetime import datetime
from pathlib import Path


def read_executions(path, month):
    executions = {}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            date = row["date_time"][:10]
            if date.startswith(month):
                executions.setdefault(date, []).append({
                    "time": row["date_time"],
                    "ticker": row["ticker"],
                    "side": row["side"],
                    "shares": float(row["shares"]),
                    "price": float(row["price"]),
                    "notional": round(float(row["shares"]) * float(row["price"]), 2),
                })
    return executions


def read_campaign_closures(path, month):
    daily = {}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            close_date = (row.get("close_date") or "")[:10]
            if close_date.startswith(month):
                pnl = float(row.get("realized_pnl") or 0)
                avg_entry = float(row.get("avg_entry") or 0)
                close_quantity = float(row.get("close_quantity") or 0)
                basis = avg_entry * close_quantity
                daily.setdefault(close_date, []).append({
                    "symbol": row["symbol"],
                    "campaignId": row["campaign_id"],
                    "openDate": (row.get("open_date") or "")[:10],
                    "closeDate": close_date,
                    "quantity": close_quantity,
                    "avgEntry": avg_entry,
                    "avgExit": float(row.get("avg_exit") or 0),
                    "pnl": round(pnl, 2),
                    "returnPct": round(float(row.get("return_percent") or 0), 2),
                    "executionCount": int(float(row.get("execution_count") or 0)),
                    "basis": basis,
                })
    return daily


def summarize_closures(closures):
    pnl = sum(item["pnl"] for item in closures)
    basis = sum(item["basis"] for item in closures)
    return {
        "pnl": round(pnl, 2),
        "returnPct": round((pnl / basis) * 100, 2) if basis else None,
        "closedTrades": len(closures),
        "basis": basis,
    }


def build_snapshot(journal_root, month):
    year, month_number = [int(part) for part in month.split("-")]
    executions = read_executions(journal_root / "Executions" / f"{month}.csv", month)
    closures = read_campaign_closures(journal_root / "Campaigns" / f"{year}.csv", month)
    daily = {date: summarize_closures(items) for date, items in closures.items()}

    days = []
    for day in range(1, calendar.monthrange(year, month_number)[1] + 1):
        date = f"{month}-{day:02d}"
        day_summary = daily.get(date, {"pnl": 0, "returnPct": None, "closedTrades": 0, "basis": 0})
        day_executions = executions.get(date, [])
        if day_summary["pnl"] or day_executions or day_summary["closedTrades"]:
            days.append({
                "date": date,
                "day": day,
                "pnl": day_summary["pnl"],
                "returnPct": day_summary["returnPct"],
                "closedTrades": day_summary["closedTrades"],
                "executions": len(day_executions),
                "trades": len(day_executions),
                "closedTradeDetails": closures.get(date, []),
                "executionDetails": day_executions,
            })

    weeks = []
    month_calendar = calendar.Calendar(firstweekday=calendar.MONDAY).monthdatescalendar(year, month_number)
    for week in month_calendar:
        dates = [date for date in week if date.month == month_number and date.weekday() < 5]
        if not dates:
            continue
        week_pnl = sum(daily.get(date.isoformat(), {"pnl": 0})["pnl"] for date in dates)
        week_basis = sum(daily.get(date.isoformat(), {"basis": 0})["basis"] for date in dates)
        weeks.append({
            "start": dates[0].isoformat(),
            "end": dates[-1].isoformat(),
            "pnl": round(week_pnl, 2),
            "returnPct": round((week_pnl / week_basis) * 100, 2) if week_basis else None,
            "trades": sum(len(executions.get(date.isoformat(), [])) for date in dates),
            "closedTrades": sum(daily.get(date.isoformat(), {"closedTrades": 0})["closedTrades"] for date in dates),
            "winDays": sum(1 for date in dates if daily.get(date.isoformat(), {"pnl": 0})["pnl"] > 0),
            "lossDays": sum(1 for date in dates if daily.get(date.isoformat(), {"pnl": 0})["pnl"] < 0),
        })

    best_day = max(days, key=lambda item: item["pnl"]) if days else None
    total_pnl = sum(item["pnl"] for item in daily.values())
    total_basis = sum(item["basis"] for item in daily.values())
    title = datetime.strptime(month, "%Y-%m").strftime("%B %Y")
    return {
        "month": month,
        "title": title,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "source": "Raw executions for activity; campaign CSVs for realized P/L and return %",
        "summary": {
            "totalPnl": round(total_pnl, 2),
            "totalReturnPct": round((total_pnl / total_basis) * 100, 2) if total_basis else None,
            "tradeCount": sum(len(items) for items in executions.values()),
            "closedTradeCount": sum(item["closedTrades"] for item in daily.values()),
            "winDays": sum(1 for item in daily.values() if item["pnl"] > 0),
            "lossDays": sum(1 for item in daily.values() if item["pnl"] < 0),
            "bestDay": best_day,
        },
        "days": days,
        "weeks": weeks,
    }


def main():
    parser = argparse.ArgumentParser(description="Generate the public trading calendar snapshot.")
    parser.add_argument("--month", default=datetime.now().strftime("%Y-%m"), help="Month in YYYY-MM format.")
    parser.add_argument(
        "--journal-root",
        default=r"C:\repos\ObsidianVault\2. Areas\Trading\07-Journal",
        help="Trading journal root folder.",
    )
    parser.add_argument(
        "--output",
        default=r"C:\repos\tools.github.io\tools\trading-calendar\data.json",
        help="Output JSON path.",
    )
    args = parser.parse_args()

    snapshot = build_snapshot(Path(args.journal_root), args.month)
    output = Path(args.output)
    output.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
