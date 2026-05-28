import argparse
import calendar
import csv
import json
from datetime import datetime
from pathlib import Path


def read_execution_counts(path, month):
    counts = {}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            date = row["date_time"][:10]
            if date.startswith(month):
                counts[date] = counts.get(date, 0) + 1
    return counts


def read_daily_pnl(path, month):
    daily = {}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            close_date = (row.get("close_date") or "")[:10]
            if close_date.startswith(month):
                daily[close_date] = daily.get(close_date, 0) + float(row.get("realized_pnl") or 0)
    return daily


def build_snapshot(journal_root, month):
    year, month_number = [int(part) for part in month.split("-")]
    execution_counts = read_execution_counts(journal_root / "Executions" / f"{month}.csv", month)
    daily_pnl = read_daily_pnl(journal_root / "Campaigns" / f"{year}.csv", month)

    days = []
    for day in range(1, calendar.monthrange(year, month_number)[1] + 1):
        date = f"{month}-{day:02d}"
        pnl = round(daily_pnl.get(date, 0), 2)
        trades = execution_counts.get(date, 0)
        if pnl or trades:
            days.append({"date": date, "day": day, "pnl": pnl, "trades": trades})

    weeks = []
    month_calendar = calendar.Calendar(firstweekday=calendar.MONDAY).monthdatescalendar(year, month_number)
    for week in month_calendar:
        dates = [date for date in week if date.month == month_number and date.weekday() < 5]
        if not dates:
            continue
        week_pnl = sum(daily_pnl.get(date.isoformat(), 0) for date in dates)
        weeks.append({
            "start": dates[0].isoformat(),
            "end": dates[-1].isoformat(),
            "pnl": round(week_pnl, 2),
            "trades": sum(execution_counts.get(date.isoformat(), 0) for date in dates),
            "winDays": sum(1 for date in dates if daily_pnl.get(date.isoformat(), 0) > 0),
            "lossDays": sum(1 for date in dates if daily_pnl.get(date.isoformat(), 0) < 0),
        })

    best_day = max(days, key=lambda item: item["pnl"]) if days else None
    title = datetime.strptime(month, "%Y-%m").strftime("%B %Y")
    return {
        "month": month,
        "title": title,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "source": "Obsidian trading journal campaign and execution CSVs",
        "summary": {
            "totalPnl": round(sum(daily_pnl.values()), 2),
            "tradeCount": sum(execution_counts.values()),
            "winDays": sum(1 for value in daily_pnl.values() if value > 0),
            "lossDays": sum(1 for value in daily_pnl.values() if value < 0),
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
