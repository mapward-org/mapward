import { observer } from "mobx-react-lite";
import type { ObjectsMap } from "@mapward/core";
import { useViewStates } from "../../../services/state/ports.tsx";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { ObjectsMapStore } from "../model/objects-map.ts";
import { ARROWS, FONT_SIZES, railObjects, ROUTES, routeIcon, WIDTHS } from "../pure-model/bar.ts";
import { useObjectsMapPort } from "../ports.tsx";
import { Graph } from "../ui/flow.tsx";
import {
  Backdrop,
  BarFrame,
  BarIcon,
  BarSep,
  BarSlot,
  ColorExtras,
  ColorGrid,
  Confirm,
  EditDialog,
  FillDot,
  HeadIcon,
  MapFrame,
  MenuFrame,
  MenuLabel,
  Message,
  PopoverFrame,
  PopoverHead,
  Presets,
  RailButton,
  RailChip,
  RailFrame,
  RailMoreItem,
  RailMoreList,
  RailSep,
  RailSpacer,
  RecentColors,
  RelationRow,
  Segmented,
  Stepper,
  StrokeRing,
  TextMark,
} from "../ui/parts.tsx";

type Props = { store: ObjectsMapStore; map: ObjectsMap };

/**
 * Рейка инструментов слева, как в Miro: фигуры, чипы прототипов цветом прототипа (сверх шести —
 * под «+»), связи, внизу отмена и повтор.
 */
const Rail = observer(function Rail(props: Props) {
  const store = props.store;
  return (
    <RailFrame>
      <RailButton
        icon="↖"
        title="Выбрать и двигать"
        on={store.isTool({ kind: "select" })}
        onClick={() => store.choose({ kind: "select" })}
      />
      <RailButton
        icon="▭"
        title="Прямоугольник — пометка, не объект"
        on={store.isTool({ kind: "shape", shape: "rect" })}
        onClick={() => store.choose({ kind: "shape", shape: "rect" })}
      />
      <RailButton
        icon="◯"
        title="Эллипс — пометка, не объект"
        on={store.isTool({ kind: "shape", shape: "ellipse" })}
        onClick={() => store.choose({ kind: "shape", shape: "ellipse" })}
      />
      <RailButton
        icon="T"
        title="Текст — пометка, не объект"
        on={store.isTool({ kind: "shape", shape: "text" })}
        onClick={() => store.choose({ kind: "shape", shape: "text" })}
      />
      <RailButton
        icon="╱"
        title="Линия — пометка, не связь: клик в начало, клик в конец"
        on={store.isTool({ kind: "line" })}
        onClick={() => store.choose({ kind: "line" })}
      />
      <RailSep />
      {railObjects(props.map.palette.objects).shown.map((item) => (
        <RailChip
          key={item.prototype}
          color={item.color}
          label={item.label}
          title={item.label}
          on={store.isTool({ kind: "object", prototype: item.prototype })}
          onClick={() => store.choose({ kind: "object", prototype: item.prototype })}
        />
      ))}
      {railObjects(props.map.palette.objects).more.length > 0 && (
        <BarSlot
          menu={
            store.railMore && (
              <RailMoreList>
                {railObjects(props.map.palette.objects).more.map((item) => (
                  <RailMoreItem
                    key={item.prototype}
                    color={item.color}
                    label={item.label}
                    on={store.isTool({ kind: "object", prototype: item.prototype })}
                    onClick={() => store.choose({ kind: "object", prototype: item.prototype })}
                  />
                ))}
              </RailMoreList>
            )
          }
        >
          <RailButton
            icon="+"
            title="Ещё прототипы"
            on={store.railMore}
            onClick={() => store.toggleRailMore()}
          />
        </BarSlot>
      )}
      {props.map.palette.relations.length > 0 && <RailSep />}
      {props.map.palette.relations.map((item) => (
        <RailChip
          key={item.prototype}
          arrow
          color={item.color}
          label={item.label}
          title={item.label}
          on={store.isTool({ kind: "relation", prototype: item.prototype })}
          onClick={() => store.choose({ kind: "relation", prototype: item.prototype })}
        />
      ))}
      <RailSpacer />
      <RailButton
        icon="↶"
        title="Отменить (Ctrl+Z)"
        disabled={!store.canUndo}
        onClick={() => store.undo()}
      />
      <RailButton
        icon="↷"
        title="Повторить (Ctrl+Shift+Z)"
        disabled={!store.canRedo}
        onClick={() => store.redo()}
      />
    </RailFrame>
  );
});

/**
 * Контекстная панель у выделенного: только применимые кнопки, выпадашка под своей кнопкой —
 * одна за раз.
 */
const ContextBar = observer(function ContextBar(props: Props) {
  const store = props.store;
  const map = props.map;
  return store.bar(map).length > 0 ? (
    <BarFrame>
      {store.bar(map).map((key, index) =>
        key === "|" ? (
          <BarSep key={index} />
        ) : key === "fill" ? (
          <BarSlot
            key={key}
            menu={
              store.menu === "fill" && (
                <MenuFrame>
                  <ColorGrid
                    value={store.look(map).fill}
                    onPick={(color) => store.apply("fill", color, map)}
                  />
                  <RecentColors
                    value={store.look(map).fill}
                    recent={store.recent}
                    onPick={(color) => store.apply("fill", color, map)}
                  />
                  <ColorExtras
                    value={store.look(map).fill}
                    onPick={(color) => store.apply("fill", color, map)}
                  />
                </MenuFrame>
              )
            }
          >
            <BarIcon
              title="Заливка"
              on={store.menu === "fill"}
              onClick={() => store.toggleMenu("fill")}
            >
              <FillDot color={store.look(map).fill} />
            </BarIcon>
          </BarSlot>
        ) : key === "stroke" ? (
          <BarSlot
            key={key}
            menu={
              store.menu === "stroke" && (
                <MenuFrame>
                  <ColorGrid
                    value={store.look(map).stroke}
                    onPick={(color) => store.apply("stroke", color, map)}
                  />
                  <RecentColors
                    value={store.look(map).stroke}
                    recent={store.recent}
                    onPick={(color) => store.apply("stroke", color, map)}
                  />
                  <ColorExtras
                    value={store.look(map).stroke}
                    onPick={(color) => store.apply("stroke", color, map)}
                  />
                </MenuFrame>
              )
            }
          >
            <BarIcon
              title="Цвет линии"
              on={store.menu === "stroke"}
              onClick={() => store.toggleMenu("stroke")}
            >
              <StrokeRing color={store.look(map).stroke} />
            </BarIcon>
          </BarSlot>
        ) : key === "text" ? (
          <BarSlot
            key={key}
            menu={
              store.menu === "text" && (
                <MenuFrame wide>
                  <MenuLabel text="Цвет текста" />
                  <ColorGrid
                    value={store.look(map).textColor}
                    onPick={(color) => store.apply("textColor", color, map)}
                  />
                  <RecentColors
                    value={store.look(map).textColor}
                    recent={store.recent}
                    onPick={(color) => store.apply("textColor", color, map)}
                  />
                  <ColorExtras
                    value={store.look(map).textColor}
                    onPick={(color) => store.apply("textColor", color, map)}
                  />
                  <MenuLabel text="Размер текста" />
                  <Presets
                    value={store.look(map).fontSize}
                    presets={FONT_SIZES}
                    onPick={(size) => store.apply("fontSize", size, map)}
                  />
                  <Stepper
                    value={store.look(map).fontSize}
                    title="Размер текста"
                    onPick={(size) => store.apply("fontSize", size, map)}
                    onStep={(delta) => store.step("fontSize", delta, map)}
                  />
                </MenuFrame>
              )
            }
          >
            <BarIcon
              title="Текст: цвет и размер"
              on={store.menu === "text"}
              onClick={() => store.toggleMenu("text")}
            >
              <TextMark color={store.look(map).textColor} size={store.look(map).fontSize} />
            </BarIcon>
          </BarSlot>
        ) : key === "width" ? (
          <BarSlot
            key={key}
            menu={
              store.menu === "width" && (
                <MenuFrame>
                  <Presets
                    value={store.look(map).width}
                    presets={WIDTHS}
                    onPick={(width) => store.apply("width", width, map)}
                  />
                  <Stepper
                    value={store.look(map).width}
                    title="Толщина линии"
                    onPick={(width) => store.apply("width", width, map)}
                    onStep={(delta) => store.step("width", delta, map)}
                  />
                </MenuFrame>
              )
            }
          >
            <BarIcon
              title="Толщина"
              on={store.menu === "width"}
              onClick={() => store.toggleMenu("width")}
            >
              ≡
            </BarIcon>
          </BarSlot>
        ) : key === "route" ? (
          <BarSlot
            key={key}
            menu={
              store.menu === "route" && (
                <MenuFrame>
                  <Segmented
                    value={store.look(map).route ?? "straight"}
                    options={ROUTES}
                    onPick={(route) => store.apply("route", route, map)}
                  />
                </MenuFrame>
              )
            }
          >
            <BarIcon
              title="Путь: ломаная, скруглённая, прямые углы"
              on={store.menu === "route"}
              onClick={() => store.toggleMenu("route")}
            >
              {routeIcon(store.look(map).route)}
            </BarIcon>
          </BarSlot>
        ) : key === "arrows" ? (
          <BarSlot
            key={key}
            menu={
              store.menu === "arrows" && (
                <MenuFrame>
                  <Segmented
                    value={store.look(map).arrows ?? "end"}
                    options={ARROWS}
                    onPick={(arrows) => store.apply("arrows", arrows, map)}
                  />
                </MenuFrame>
              )
            }
          >
            <BarIcon
              title="Стрелки линии"
              on={store.menu === "arrows"}
              onClick={() => store.toggleMenu("arrows")}
            >
              →
            </BarIcon>
          </BarSlot>
        ) : key === "edit" ? (
          <BarIcon key={key} title="Править имя и адрес" onClick={() => store.editSelected(map)}>
            ✎
          </BarIcon>
        ) : key === "dive" ? (
          <BarIcon key={key} title="Провалиться в объект" onClick={() => store.diveSelected(map)}>
            ↘
          </BarIcon>
        ) : (
          <BarIcon key={key} title="Удалить" danger onClick={() => store.removeSelected(map)}>
            🗑
          </BarIcon>
        ),
      )}
    </BarFrame>
  ) : null;
});

/** Поповер: карточка объекта с ✎ ↘ × в шапке или список склеенных связей. */
const PopoverContent = observer(function PopoverContent(props: Props) {
  const port = useObjectsMapPort();
  const store = props.store;
  return store.popoverAddress !== undefined ? (
    <PopoverFrame>
      <port.Card
        item={{ object: store.popoverAddress }}
        actions={
          <>
            <HeadIcon
              icon="✎"
              title="Править имя и адрес"
              onClick={() => store.startEdit(store.popoverAddress ?? "", props.map)}
            />
            <HeadIcon
              icon="↘"
              title="Провалиться в объект"
              onClick={() => store.dive(store.popoverAddress ?? "")}
            />
            <HeadIcon icon="×" title="Закрыть" onClick={() => store.closePopover()} />
          </>
        }
      />
    </PopoverFrame>
  ) : store.popoverItems.length > 0 ? (
    <PopoverFrame>
      <PopoverHead title="Стрелка собрана из связей" onClose={() => store.closePopover()} />
      {store.popoverItems.map((item) => (
        <RelationRow
          key={item.link}
          label={item.label}
          link={item.link}
          onPick={() => store.openRelation(item.link)}
        />
      ))}
    </PopoverFrame>
  ) : null;
});

/**
 * Вьюха карты — значение метрики `objects-map` (решение 0044): что показать, как нарисовать и
 * куда тянутся стрелки, собрал сервер, а здесь это ложится на холст. Холст ничего не решает сам:
 * каждое действие — операция правки на сервере. Пока новое значение не пришло, холст рисует
 * картинку стора — значение с ожидающими правками поверх, — и узлы не прыгают.
 */
export const ObjectsMapView = observer(function ObjectsMapView(props: {
  map: ObjectsMap;
  address: string;
}) {
  const port = useObjectsMapPort();
  const views = useViewStates();
  const store = useLocalStore(
    () => new ObjectsMapStore(port, views, props.address),
    [props.address],
  );
  const editing = store.editing;
  const message = store.message;

  return (
    <MapFrame>
      <Rail store={store} map={props.map} />
      <Graph
        map={store.picture(props.map)}
        viewport={store.view}
        tool={store.tool}
        renaming={store.renaming}
        hint={store.cursorHint}
        onOpenTab={port.openTab}
        onViewport={(viewport) => store.pan(viewport)}
        onEdit={(ops) => store.edit(ops, props.map)}
        onPopover={(next) => (next ? store.open(next) : store.closePopover())}
        onRename={(id) => store.rename(id)}
        onDelete={(target) => store.ask(target)}
        onSay={(text) => store.say(text)}
        onToolDone={() => store.choose({ kind: "select" })}
        onUndo={() => store.undo()}
        onRedo={() => store.redo()}
        onEscape={() => store.escape()}
        onPlace={(draft) => store.place(draft)}
        onDraft={(name) => store.commitDraft(name, props.map)}
        onDraftCancel={() => store.dropDraft()}
        onSelect={(chosen) => store.select(chosen)}
        onLine={(end) => store.lineAt(end, props.map)}
        pinned={[
          {
            ...store.barAt(props.map),
            side: "top",
            content: <ContextBar store={store} map={props.map} />,
          },
          {
            ...store.popoverAt(props.map),
            side: "right",
            content: <PopoverContent store={store} map={props.map} />,
          },
        ]}
        renderCard={(item) => <port.Card item={item} />}
      />
      {editing && <Backdrop onClose={() => store.closeEdit()} />}
      {editing && (
        <EditDialog
          name={editing.name}
          folder={editing.folder}
          onSave={(name, folder) => store.save(name, folder, props.map)}
          onClose={() => store.closeEdit()}
        />
      )}
      {store.confirmText && <Backdrop onClose={() => store.cancel()} />}
      {store.confirmText && (
        <Confirm
          text={store.confirmText}
          onYes={() => store.remove(props.map)}
          onNo={() => store.cancel()}
        />
      )}
      {message && (
        <Message text={message.text} error={message.error} onClose={() => store.say(undefined)} />
      )}
    </MapFrame>
  );
});
