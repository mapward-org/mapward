import { observer } from "mobx-react-lite";
import { useViewStates } from "../../../services/state/ports.tsx";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { RunsScreenStore } from "../model/runs-screen.ts";
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
import { RunDot, RunItem, RunList, RunsEmpty, RunsFrame, RunsTabs } from "../ui/run-list.tsx";

/**
 * Экран прогонов объекта — решение 0038: прогоны свежими сверху, выбранный справа, а выбор
 * живёт в истории экрана (решение 0036). Общего списка на карту нет: карта строится зонами, и
 * чужие прогоны были бы шумом.
 */
export const RunsScreen = observer(function RunsScreen(props: {
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  const runs = useRuns();
  const views = useViewStates();
  const screen = useLocalStore(
    () =>
      new RunsScreenStore(
        () => runs.list,
        () => props.selected,
        views.slot<RunsTab>("runs-tab", "actions"),
      ),
    [runs, props.selected],
  );
  const run = screen.open;

  return screen.total === 0 ? (
    <RunsEmpty />
  ) : (
    <RunsFrame
      tabs={<RunsTabs tab={screen.tab} onTab={(tab) => screen.setTab(tab)} />}
      list={
        <RunList empty={screen.shown.length === 0}>
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
      {run && (
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
                >
                  {step.output && <RunText title="результат" text={step.output} />}
                  {step.log && (
                    <RunText title="лог" text={step.log} error={step.status === "failure"} />
                  )}
                </RunStep>
              ))}
            </RunSteps>
          </RunBlock>
          {screen.config !== undefined && (
            <RunBlock title="Конфиг">
              <RunText title="после подстановок" text={screen.config} />
            </RunBlock>
          )}
        </RunDetails>
      )}
    </RunsFrame>
  );
});
