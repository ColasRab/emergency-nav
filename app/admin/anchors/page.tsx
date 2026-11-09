import { redirect } from "next/navigation";
export default function PreviousAnchorSetup() {
  redirect("/?setup=gps");
}
