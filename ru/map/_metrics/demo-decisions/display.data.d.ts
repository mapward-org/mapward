// Написано `mapward display check` по схеме метрики — руками не править.
export type Data = {
  decisions: Array<{
    number: string;
    title: string;
    file: string;
    draft: boolean;
  }>;
};
