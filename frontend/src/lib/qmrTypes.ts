export type QmrLeaf = {
  code: string;
  description: string;
  uom: string;
  pf_rate: number;
  budget_qty: number;
  earned_qty: number;
  installed_qty: number;
  budget_hrs: number;
  spent_hrs: number;
  earned_hrs: number;
  percent_complete: number;
  record_count: number;
};

export type QmrTotals = {
  budget_qty: number;
  earned_qty: number;
  installed_qty: number;
  budget_hrs: number;
  spent_hrs: number;
  earned_hrs: number;
  percent_complete: number;
  record_count: number;
};

export type QmrCraft = {
  prime: string;
  display_name: string;
  leaves: QmrLeaf[];
  totals: QmrTotals;
};
