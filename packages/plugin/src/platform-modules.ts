import * as Rxjs from "rxjs";
import * as RxjsOperators from "rxjs/operators";
import * as Typebox from "typebox";
import * as TypeboxCompile from "typebox/compile";
import * as TypeboxError from "typebox/error";
import * as TypeboxFormat from "typebox/format";
import * as TypeboxGuard from "typebox/guard";
import * as TypeboxSchema from "typebox/schema";
import * as TypeboxSystem from "typebox/system";
import * as TypeboxType from "typebox/type";
import * as TypeboxValue from "typebox/value";

/**
 * Модули, которые плагину даёт платформа: сборщик плагина подставляет их по имени вместо
 * `node_modules`. Это те же копии, на которых живёт рантайм, — `instanceof Observable` и
 * операторы работают между `ctx` и кодом плагина, а ставить ничего не надо. Авторы импортируют
 * `rxjs` и `typebox` как обычно; отсюда их берёт только сборка.
 */
export const platformModules: Readonly<Record<string, object>> = {
  rxjs: Rxjs,
  "rxjs/operators": RxjsOperators,
  typebox: Typebox,
  "typebox/compile": TypeboxCompile,
  "typebox/error": TypeboxError,
  "typebox/format": TypeboxFormat,
  "typebox/guard": TypeboxGuard,
  "typebox/schema": TypeboxSchema,
  "typebox/system": TypeboxSystem,
  "typebox/type": TypeboxType,
  "typebox/value": TypeboxValue,
};
