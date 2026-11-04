export const SETTING_KEYS = ["budget_alerts", "projections", "reminder", "daily_analysis", "weekly_report", "monthly_report", "backup", "positive"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
