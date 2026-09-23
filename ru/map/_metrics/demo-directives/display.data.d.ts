// Написано `mapward display check` по схеме метрики — руками не править.
export type Data = {
  directives: Array<{
    name: string;
    object: string;
    file: string;
    status: "open" | "done";
    stage: string | null;
    runs: number;
  }>;
};
