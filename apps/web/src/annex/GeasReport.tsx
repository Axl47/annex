import type {
  EnvironmentId,
  GeasCheck,
  GeasMediaRef,
  GeasProofBlock,
  GeasReport as GeasReportValue,
} from "@t3tools/contracts";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CircleXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { useAssetUrlState } from "../assets/assetUrls";
import ChatMarkdown from "../components/ChatMarkdown";
import { cn } from "../lib/utils";

const VIDEO_MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

function GeasMedia({
  environmentId,
  media,
  className,
}: {
  readonly environmentId: EnvironmentId;
  readonly media: GeasMediaRef;
  readonly className?: string;
}) {
  const mimeType =
    media.kind === "video"
      ? VIDEO_MIME_TYPES[media.attachmentId.split("-").at(-1) ?? ""]
      : undefined;
  const url = useAssetUrlState(environmentId, {
    _tag: "attachment",
    attachmentId: media.attachmentId,
    ...(mimeType === undefined ? {} : { mimeType, disposition: "inline" as const }),
  });
  const frame = cn(
    "flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border bg-muted/40",
    className,
  );
  if (url._tag !== "Success") {
    return (
      <div className={cn(frame, "text-xs text-muted-foreground")}>
        {url._tag === "Failure" ? "Could not load this file." : null}
      </div>
    );
  }
  return (
    <figure className="flex min-w-0 flex-col gap-1">
      <div className={frame}>
        {media.kind === "video" ? (
          <video src={url.url} controls preload="metadata" className="size-full object-contain">
            <track kind="captions" />
          </video>
        ) : (
          <a href={url.url} target="_blank" rel="noreferrer" className="size-full">
            <img
              src={url.url}
              alt={media.alt}
              loading="lazy"
              className="size-full object-contain"
            />
          </a>
        )}
      </div>
      {media.alt ? (
        <figcaption className="text-xs text-muted-foreground">{media.alt}</figcaption>
      ) : null}
    </figure>
  );
}

function Caption({ text }: { readonly text: string | undefined }) {
  return text ? <p className="text-xs text-muted-foreground">{text}</p> : null;
}

function ProofBlock({
  environmentId,
  block,
}: {
  readonly environmentId: EnvironmentId;
  readonly block: GeasProofBlock;
}) {
  switch (block.type) {
    case "compare":
      return (
        <div className="flex flex-col gap-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Before</span>
              <GeasMedia environmentId={environmentId} media={block.before} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">After</span>
              <GeasMedia environmentId={environmentId} media={block.after} />
            </div>
          </div>
          <Caption text={block.caption} />
        </div>
      );
    case "media":
      return (
        <div className="flex flex-col gap-2">
          <div className={cn("grid gap-3", block.items.length > 1 && "sm:grid-cols-2")}>
            {block.items.map((media) => (
              <GeasMedia key={media.attachmentId} environmentId={environmentId} media={media} />
            ))}
          </div>
          <Caption text={block.caption} />
        </div>
      );
    case "table":
      return (
        <div className="flex flex-col gap-2">
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  {block.columns.map((column, index) => (
                    // oxlint-disable-next-line react/no-array-index-key -- columns are positional
                    <th key={index} className="px-3 py-1.5 font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  // oxlint-disable-next-line react/no-array-index-key -- rows are positional
                  <tr key={rowIndex} className="border-t">
                    {row.map((cell, cellIndex) => (
                      // oxlint-disable-next-line react/no-array-index-key -- cells are positional
                      <td key={cellIndex} className="px-3 py-1.5 tabular-nums">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Caption text={block.caption} />
        </div>
      );
    case "markdown":
      return (
        <div className="flex flex-col gap-2">
          <ChatMarkdown text={block.markdown} cwd={undefined} environmentId={environmentId} />
          <Caption text={block.caption} />
        </div>
      );
  }
}

const CHECK_PRESENTATION = {
  passed: { Icon: CircleCheckIcon, className: "text-success", label: "Passed" },
  failed: { Icon: CircleXIcon, className: "text-destructive", label: "Failed" },
  unverified: { Icon: CircleHelpIcon, className: "text-muted-foreground", label: "Not verified" },
} as const;

function CheckRow({ check }: { readonly check: GeasCheck }) {
  const { Icon, className, label } = CHECK_PRESENTATION[check.status];
  return (
    <li className="flex min-w-0 items-start gap-2 text-sm">
      <Icon aria-label={label} className={cn("mt-0.5 size-4 shrink-0", className)} />
      <div className="flex min-w-0 flex-col">
        <span>
          {check.label}
          {check.status === "failed" && check.exitCode !== null ? (
            <span className="ml-1.5 text-xs text-muted-foreground">exit {check.exitCode}</span>
          ) : null}
          {check.status === "unverified" ? (
            <span className="ml-1.5 text-xs text-muted-foreground">
              not seen running in the thread
            </span>
          ) : null}
        </span>
        <code className="truncate font-mono text-xs text-muted-foreground">{check.command}</code>
      </div>
    </li>
  );
}

function Slot({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2" data-report-section={title}>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function GeasReport({
  environmentId,
  report,
  running,
}: {
  readonly environmentId: EnvironmentId;
  readonly report: GeasReportValue;
  readonly running: boolean;
}) {
  const empty =
    report.result.trim() === "" &&
    report.proof.length === 0 &&
    report.checks.length === 0 &&
    report.details.trim() === "";
  if (empty) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
        <CircleAlertIcon className="size-4" />
        {running ? "The agent is working; the report shows up here." : "No report yet."}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {report.result.trim() !== "" ? (
        <p
          className="text-base leading-relaxed font-medium text-pretty"
          data-report-section="Result"
        >
          {report.result}
        </p>
      ) : null}
      {report.risks.length > 0 ? (
        <Slot title="Risks">
          <ul className="flex flex-col gap-1.5">
            {report.risks.map((risk, index) => (
              // oxlint-disable-next-line react/no-array-index-key -- risks are positional
              <li key={index} className="flex items-start gap-2 text-sm">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </Slot>
      ) : null}
      {report.proof.length > 0 ? (
        <Slot title="Proof">
          <div className="flex flex-col gap-5">
            {report.proof.map((block, index) => (
              // oxlint-disable-next-line react/no-array-index-key -- proof blocks are positional
              <ProofBlock key={index} environmentId={environmentId} block={block} />
            ))}
          </div>
        </Slot>
      ) : null}
      {report.checks.length > 0 ? (
        <Slot title="Checks">
          <ul className="flex flex-col gap-2">
            {report.checks.map((check, index) => (
              // oxlint-disable-next-line react/no-array-index-key -- checks are positional
              <CheckRow key={index} check={check} />
            ))}
          </ul>
        </Slot>
      ) : null}
      {report.details.trim() !== "" ? (
        <Slot title="Details">
          <ChatMarkdown text={report.details} cwd={undefined} environmentId={environmentId} />
        </Slot>
      ) : null}
    </div>
  );
}
