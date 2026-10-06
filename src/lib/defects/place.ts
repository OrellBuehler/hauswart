/** "Room · device · detail" for a defect, without the empty parts. */
export function defectPlace(defect: {
  roomName: string | null;
  assetName: string | null;
  locationDetail: string | null;
}): string {
  return [defect.roomName, defect.assetName, defect.locationDetail]
    .filter(Boolean)
    .join(" · ");
}
