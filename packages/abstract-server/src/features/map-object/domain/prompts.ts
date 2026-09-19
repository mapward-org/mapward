import type { DirectiveMode, MapObject } from "@mapward/core";

/**
 * Prompts are the whole interface to the agent, so they live in pure-model: they can be read
 * without an editor, and the rules they carry come from decision 0002.
 */
export function objectPrompt(object: MapObject, mapPath: string): string {
  return [
    `Работаем с объектом карты mapward «${object.name}».`,
    `Карта: ${mapPath}. Объект: ${object.path} (${object.address}).`,
    "",
    "Правки лучше делать через директивы: положи текст в _directives и выполни его,",
    "тогда сделанное останется записанным, а не только в этом разговоре.",
  ].join("\n");
}

/**
 * Three buttons, three prompts. `check` reads, `dry-run` plans, `run` acts — and only the
 * last one is allowed to touch files, so a mistake in the wording costs nothing until then.
 */
export function directivePrompt(
  mode: DirectiveMode,
  directivePath: string,
  object: MapObject,
  mapPath: string,
): string {
  const head = [
    `Директива: ${directivePath}`,
    `Объект карты: «${object.name}», ${object.path} (${object.address}).`,
    `Карта: ${mapPath}.`,
    "",
  ];

  const tail = {
    check: [
      "Прочитай директиву и проверь её, ничего не меняя:",
      "— понятно ли, что нужно сделать, нет ли противоречий с решениями карты;",
      "— существуют ли файлы и адреса, на которые она ссылается;",
      "— что осталось недосказанным и о чём стоит спросить.",
      "Ответь текстом, файлы не трогай.",
    ],
    "dry-run": [
      "Прочитай директиву и расскажи, что именно сделаешь: какие файлы создашь,",
      "какие изменишь и что в них появится. Файлы не трогай — это сухой прогон.",
      "Отдельно назови места, где придётся решать за человека.",
    ],
    run: [
      "Выполни директиву.",
      "",
      "Перед началом закоммить точечно файлы, которые будешь править, — тогда результат",
      "виден диффом, а откат делается git restore по конкретным путям.",
      "Результат не коммить: его смотрит человек.",
      "",
      "Когда закончишь, запиши состояние рядом с директивой:",
      "_directives.state/<имя директивы>.state.json вида",
      '{ "directive": "<полная копия текста директивы>", "status": "done", "ran": "<время>" }.',
      "Копия нужна, чтобы потом было видно, менялась ли директива после выполнения.",
    ],
  }[mode];

  return [...head, ...tail].join("\n");
}
