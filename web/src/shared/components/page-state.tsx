import { Card } from "@/shared/ui/card";

export function PageState(props: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-80 items-center justify-center">
      <Card className="max-w-xl gap-0 bg-muted/80 px-8 py-10 text-center">
        <p className="text-xs uppercase  text-muted-foreground">{props.eyebrow}</p>
        <h3 className="mt-4 text-2xl font-semibold tracking-normal font-semibold text-foreground">
          {props.title}
        </h3>
        <p className="mt-4 text-base leading-7 text-muted-foreground">{props.description}</p>
      </Card>
    </div>
  );
}
