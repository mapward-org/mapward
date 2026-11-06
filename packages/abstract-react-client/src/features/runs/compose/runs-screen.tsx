import { useViewStates } from "../../../services/state/ports.tsx";
import { useLocalStore } from "../../../lib/store/use-local-store.ts";
import { useWatch } from "../../../lib/store/use-watch.ts";
import { FollowBottom } from "../../../lib/store/follow-bottom.ts";
import { LogsPanelStore } from "../model/logs-panel.ts";
import { RunsScreenStore } from "../model/runs-screen.ts";
import type { LogScope } from "../pure-model/logs.ts";
import type { RunsTab } from "../pure-model/runs.ts";
import { useRuns } from "../ports.tsx";
import {
  RunBlock,
  RunDetails,
  RunHeader,
  RunInputs,
  RunStep,
  RunSteps,
  RunText,
} from "../ui/run-details.tsx";
import { ObjectLogItem, RunDot, RunItem, RunList, RunsFrame, RunsTabs } from "../ui/run-list.tsx";
import {
  LogBar,
  LogField,
  LogFiles,
  LogHead,
  LogLines,
  LogRow,
  LogScopes,
  LogTrace,
  TraceLink,
} from "../ui/run-logs.tsx";

/**
 * Экран прогонов объекта — решение 0038 и директива «логи плагинов»: интерфейс к логам. Слева
 * лог объекта и прогоны свежими сверху, справа выбранное: лог объекта с фильтром по плагину —
 * основной вид, — или прогон со строками его трейса. Выбор живёт в истории экрана (решение 0036).
 * «Вся карта» — вид для отладки: карта строится зонами, и чужие строки обычно шум.
 */
export function RunsScreen(props: {
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const runs = useRuns();
  const views = useViewStates();
  const screen = useLocalStore(
    () =>
      new RunsScreenStore(runs, () => props.selected, views.slot<RunsTab>("runs-tab", "actions")),
    [runs, props.selected],
  );
  const logs = useLocalStore(
    () =>
      new LogsPanelStore(
        runs,
        screen,
        views.slot<LogScope>("runs-log-scope", "object"),
        views.slot<string>("runs-log-file", ""),
        views.slot<string>("runs-log-trace", ""),
      ),
    [runs, screen],
  );
  useWatch(screen, logs);
  const run = screen.open;
  // Лог держится у конца, пока человек сам не отмотал вверх.
  const follow = useLocalStore(() => new FollowBottom());

  return (
    <RunsFrame
      tabs={<RunsTabs tab={screen.tab} onTab={(tab) => screen.setTab(tab)} />}
      list={
        <RunList empty={screen.shown.length === 0}>
          <ObjectLogItem selected={screen.logOpen} onSelect={() => logs.openLog(props.onSelect)} />
          {screen.shown.map((one) => (
            <RunItem
              key={one.id}
              run={one}
              now={screen.now}
              selected={one.id === run?.id}
              dot={<RunDot status={one.status} />}
              onSelect={props.onSelect}
            />
          ))}
        </RunList>
      }
    >
      {run ? (
        <RunDetails>
          <RunHeader
            run={run}
            now={screen.now}
            dot={<RunDot status={run.status} />}
            onStop={(id) => runs.stop(id)}
          />
          {run.error && <RunText title="почему" text={run.error} error />}
          {screen.inputs.length > 0 && (
            <RunBlock title="Данные формы">
              <RunInputs inputs={screen.inputs} />
            </RunBlock>
          )}
          <RunBlock title="Шаги">
            <RunSteps empty={run.steps.length === 0}>
              {run.steps.map((step, index) => (
                <RunStep
                  key={index}
                  step={step}
                  index={index}
                  now={screen.now}
                  dot={<RunDot status={step.status} />}
                />
              ))}
            </RunSteps>
          </RunBlock>
          <RunBlock title={logs.title}>
            <LogLines empty={logs.empty} follow={follow.hold}>
              <LogRows logs={logs} onSelect={props.onSelect} />
            </LogLines>
          </RunBlock>
          {screen.result !== undefined && (
            <RunBlock title="Итог">
              <RunText title="что отдал метод" text={screen.result} />
            </RunBlock>
          )}
          {screen.config !== undefined && (
            <RunBlock title="Конфиг">
              <RunText title="после подстановок" text={screen.config} />
            </RunBlock>
          )}
        </RunDetails>
      ) : (
        <RunDetails>
          <LogBar>
            {logs.picked === undefined ? (
              <>
                <LogScopes scope={logs.scope} onScope={(scope) => logs.setScope(scope)} />
                <LogFiles
                  files={logs.files}
                  file={logs.file}
                  platform={logs.platform}
                  onFile={(file) => logs.setFile(file)}
                />
              </>
            ) : (
              <LogTrace trace={logs.picked} onClear={() => logs.clearTrace()} />
            )}
          </LogBar>
          <RunBlock title={logs.title}>
            <LogLines empty={logs.empty} follow={follow.hold}>
              <LogRows logs={logs} onSelect={props.onSelect} />
            </LogLines>
          </RunBlock>
        </RunDetails>
      )}
    </RunsFrame>
  );
}

/** Строки лога: шапка с номером трейса-ссылкой и поля под ней. */
function LogRows(props: { logs: LogsPanelStore; onSelect: (id: string | undefined) => void }) {
  const { logs } = props;
  return logs.lines.map((line, index) => (
    <LogRow
      key={index}
      head={
        <LogHead
          line={line}
          trace={
            line.trace !== undefined && (
              <TraceLink
                trace={line.trace}
                current={logs.trace}
                onTrace={(trace) => logs.showTrace(trace, props.onSelect)}
              />
            )
          }
        />
      }
    >
      {logs.fields(line).map(([key, value]) => (
        <LogField key={key} name={key} value={value} />
      ))}
    </LogRow>
  ));
}
