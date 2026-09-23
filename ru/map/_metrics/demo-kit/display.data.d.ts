// Написано `mapward display check` по схеме метрики — руками не править.
export type Data = {
  note: string;
  items: Array<{
    label: string;
    status?: string;
    color?: string;
    hint?: string;
    description?: string;
  }>;
  tree: unknown[];
};
