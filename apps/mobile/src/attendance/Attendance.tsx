import { AttendanceScreen } from "./AttendanceScreen";
import { useAttendanceService } from "./context";
import { useAttendance } from "./useAttendance";

/** The Visits tab of a member. */
export function Attendance() {
  const service = useAttendanceService();
  const attendance = useAttendance(service);
  return (
    <AttendanceScreen
      state={attendance.state}
      onRetry={attendance.retry}
      onEndReached={attendance.loadMore}
    />
  );
}
