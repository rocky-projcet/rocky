import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { driver, type Driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import "./product-tour.css";

import { useAgentsQuery } from "@/domains/agent/hooks";
import { useRockyChatsQuery } from "@/domains/rocky/hooks";
import { filterUserManagedAgents } from "@/domains/rocky/lib/rocky-agent-catalog";
import { useProductTour } from "./use-product-tour";

export function ProductTourOrchestrator() {
  const { state, setState } = useProductTour();
  const location = useLocation();
  const navigate = useNavigate();
  const driverRef = useRef<Driver | null>(null);
  const startedRef = useRef(false);

  const agentsQuery = useAgentsQuery({ includeArchived: false });
  const chatsQuery = useRockyChatsQuery();
  const hasAgents =
    filterUserManagedAgents(agentsQuery.data ?? []).filter(
      (agent) => agent.lifecycle === "active",
    ).length > 0;
  const hasTasks = (chatsQuery.data ?? []).length > 0;

  useEffect(() => {
    return () => {
      driverRef.current?.destroy();
      driverRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (state !== "not-started") return;
    if (location.pathname !== "/") return;
    if (startedRef.current) return;
    startedRef.current = true;

    const timer = window.setTimeout(() => {
      driverRef.current?.destroy();
      const steps: DriveStep[] = [
        {
          popover: {
            title: "Rocky 둘러보기",
            description:
              "1분 안에 어떤 화면이 어디에 있는지 빠르게 보여드릴게요.",
          },
        },
        {
          element: '[data-tour="nav-agents"]',
          popover: {
            side: "right",
            align: "start",
            title: "직원 (에이전트)",
            description:
              "스킬을 장착해 작업을 처리하는 일꾼이에요. 색·이모지로 한눈에 구분합니다.",
          },
        },
        {
          element: '[data-tour="nav-skills"]',
          popover: {
            side: "right",
            align: "start",
            title: "공용 스킬",
            description:
              "직원이 발사하는 능력 한 단위예요. 직원에게 장착되는 순간 그 직원만의 사본으로 분기돼서, 이후엔 직원 안에서 따로 자라납니다.",
          },
        },
        {
          element: '[data-tour="nav-skill-templates"]',
          popover: {
            side: "right",
            align: "start",
            title: "스킬 템플릿",
            description:
              "스킬을 처음 만들 때 쓰는 레시피 모음이에요. 여기서 한 장 골라 시작하면 됩니다.",
          },
        },
        {
          element: '[data-tour="nav-tasks"]',
          popover: {
            side: "right",
            align: "start",
            title: "작업",
            description:
              "직원에게 시킨 한 번의 의뢰예요. 완료된 작업은 직원의 경험치가 됩니다.",
          },
        },
        {
          element: '[data-tour="topbar-search"]',
          popover: {
            side: "bottom",
            align: "end",
            title: "검색",
            description:
              "직원·스킬·작업·파일을 모두 이 한 곳에서 찾을 수 있어요.",
          },
        },
      ];

      if (hasAgents) {
        steps.push({
          element: '[data-tour="top-agents"]',
          popover: {
            side: "top",
            align: "start",
            title: "우수 에이전트 + 레벨",
            description:
              "완료한 작업이 많은 직원이 🥇🥈🥉으로 올라와요. 작업 5개를 끝낼 때마다 레벨이 +1 올라갑니다.",
          },
        });
      }

      if (hasTasks) {
        steps.push({
          element: '[data-tour="recent-files"]',
          popover: {
            side: "top",
            align: "start",
            title: "최근 저장된 파일",
            description:
              "작업 결과로 만들어진 파일이 여기로 모여요. 다시 다운받거나 미리보기 가능합니다.",
          },
        });
      }

      steps.push({
        popover: {
          title: "이제 시작해볼까요?",
          description:
            "첫 직원을 만들어 첫 작업을 보내봐요. 도움말 메뉴에서 언제든 다시 볼 수 있어요.",
          doneBtnText: "직원 만들기",
          onNextClick: () => {
            setState("completed");
            driverRef.current?.destroy();
            driverRef.current = null;
            window.setTimeout(() => navigate("/agents/new"), 60);
          },
        },
      });

      const d = driver({
        animate: true,
        smoothScroll: true,
        showProgress: true,
        progressText: "{{current}} / {{total}}",
        allowClose: true,
        overlayColor: "oklch(0.145 0 0)",
        overlayOpacity: 0.5,
        stagePadding: 6,
        stageRadius: 14,
        popoverClass: "rocky-tour-popover",
        showButtons: ["next", "previous", "close"],
        nextBtnText: "다음",
        prevBtnText: "이전",
        doneBtnText: "끝",
        onDestroyed: () => {
          // If user closed mid-tour or finished without the final CTA path,
          // mark completed so it doesn't auto-start again.
          setState("completed");
        },
        steps,
      });
      d.drive();
      driverRef.current = d;
    }, 250);

    return () => window.clearTimeout(timer);
  }, [state, location.pathname, navigate, setState]);

  return null;
}
