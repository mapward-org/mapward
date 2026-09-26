import { expect, test } from "vitest";
import { FocusRequests, type FocusRequest } from "./focus-requests.ts";

const core = { mapPath: "d:/map", address: "mapward://packages/core" };
const cli = { mapPath: "d:/map", address: "mapward://packages/cli" };

const collect = (requests: FocusRequests) => {
  const got: FocusRequest[] = [];
  const subscription = requests.watch().subscribe((request) => got.push(request));
  return { got, stop: () => subscription.unsubscribe() };
};

test("подписчик есть — просьба уходит сразу", () => {
  const requests = new FocusRequests();
  const sidebar = collect(requests);
  requests.request(core);
  expect(sidebar.got).toEqual([core]);
});

test("подписчика нет — ждёт последняя", () => {
  const requests = new FocusRequests();
  requests.request(core);
  requests.request(cli);
  expect(collect(requests).got).toEqual([cli]);
});

test("отдаётся один раз: пересозданный сайдбар не прыгает", () => {
  const requests = new FocusRequests();
  requests.request(core);
  collect(requests).stop();
  expect(collect(requests).got).toEqual([]);
});

test("отданная подписчику просьба не ждёт следующего", () => {
  const requests = new FocusRequests();
  const sidebar = collect(requests);
  requests.request(core);
  sidebar.stop();
  expect(collect(requests).got).toEqual([]);
});
