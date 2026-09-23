import { observer } from "mobx-react-lite";
import type { MapObject } from "@mapward/core";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { ActionsIcon, IndexIcon, MetricsIcon, WorkflowIcon } from "../../../lib/ui/icons.tsx";
import { Section } from "../../../lib/ui/section.tsx";
import { MetaStore } from "../model/meta-store.ts";
import { useMetaPort } from "../ports.tsx";
import {
  ActionRow,
  MetaFrame,
  MetaNothing,
  MetricRow,
  ObjectFields,
  ObjectRow,
  StageRow,
} from "../ui/meta-view.tsx";

/**
 * Мета-экран объекта: всё, что объект о себе знает, с одним поиском на весь экран
 * (решение 0024). Разделы сворачиваются, действия строки — в меню «слои» (решение 0028).
 * Раздел без совпадений не рисуется, чтобы найденное не терялось между пустыми заголовками.
 * Раздел директив рисует их фича по уже отобранному списку.
 */
export const MetaScreen = observer(function MetaScreen(props: { object: MapObject }) {
  const port = useMetaPort();
  const meta = useLocalStore(() => new MetaStore(() => props.object, port), [props.object]);
  const found = meta.found;

  return (
    <MetaFrame query={meta.query} onQuery={(query) => meta.setQuery(query)}>
      {found.nothing && <MetaNothing />}

      {found.object && (
        <Section icon={IndexIcon} title="Объект">
          <ObjectRow object={props.object} menu={meta.objectMenu} />
          <ObjectFields fields={found.fields} />
        </Section>
      )}

      {found.metrics.length > 0 && (
        <Section icon={MetricsIcon} title="Метрики">
          {found.metrics.map((metric) => (
            <MetricRow key={metric.key} metric={metric} menu={meta.metricMenu(metric)} />
          ))}
        </Section>
      )}

      {/*
        Этапы стоят перед директивами: по ним читают, что у директивы вообще можно запустить,
        а архив — это то, куда заглядывают реже.
      */}
      {found.workflow.length > 0 && (
        <Section icon={WorkflowIcon} title="Этапы директив">
          {found.workflow.map((stage) => (
            <StageRow key={stage.name} stage={stage} onOpen={meta.stageOpen(stage)} />
          ))}
        </Section>
      )}

      {/* Экшоны — над директивами: их запускают и правят чаще, чем листают архив директив. */}
      {found.actions.length > 0 && (
        <Section icon={ActionsIcon} title="Экшоны">
          {found.actions.map((action) => (
            <ActionRow key={action.address} action={action} onOpen={meta.actionOpen(action)} />
          ))}
        </Section>
      )}

      {meta.showDirectives && <port.Directives object={props.object} files={found.directives} />}
    </MetaFrame>
  );
});
