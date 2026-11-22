import {history, priority, sampleCompanyFor, sampleMonitoringDate, sampleMonitoringTime} from './data.mjs';
import {simulationStatuses} from './simulations.mjs';

const pitchTaskStatus = {
  claimed: 'Acknowledged',
  pending: 'Waiting for acknowledgement',
  open: 'Escalated',
};

function pitchRecordText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 360) : '';
}

export function buildPitchAlertContext({state, openIncidents, reportRows, investigate, selectedId}) {
  const openRows = new Map(reportRows.filter(row => !Number.isFinite(row.closedAt))
    .sort((a, b) => a.openedAt - b.openedAt).map(row => [row.incident, row]));
  const open = openIncidents.filter(incident => !incident.groupedUnder && incident.triggeredAt !== null)
    .map(incident => {
      const {id, title, service, company, fingerprint} = incident;
      const custom = state.custom[id];
      const task = state.tasks[id];
      const run = openRows.get(id);
      const receivedAt = state.arrivals[id] ?? incident.triggeredAt ?? sampleMonitoringTime(incident.alert);
      const matchingRun = run?.openedAt === receivedAt ? run : null;
      const assignee = matchingRun?.acceptedBy || (task?.status === 'claimed' && task.acceptedAt >= receivedAt ? task.by : undefined);
      const reportedStatus = custom ? simulationStatuses[custom.status] : pitchTaskStatus[task?.status] || 'Needs review';
      const status = assignee && ['Reported', 'Needs review', 'Waiting for acknowledgement', 'Escalated'].includes(reportedStatus)
        ? 'Acknowledged' : reportedStatus;
      const brief = investigate(incident);
      return {
        id, title, service, company, fingerprint, status, assignee, sample: true,
        priority: custom?.level || state.priorities[id] || priority(incident),
        occurredAt: incident.occurredAt ?? sampleMonitoringTime(incident.alert),
        receivedAt,
        summary: pitchRecordText(custom?.description || brief.findings[0]?.text),
        hypothesis: brief.certainty === 'Likely' ? pitchRecordText(brief.cause) : '',
        nextCheck: pitchRecordText(brief.next),
        latestUpdate: pitchRecordText(custom?.activity?.at(-1)?.note),
      };
    });

  const closed = reportRows.filter(row => Number.isFinite(row.closedAt)).map(row => {
    const custom = state.custom[row.incident];
    const saved = state.resolutions[row.incident];
    const reviewed = saved?.resolvedAt === row.closedAt ? saved : null;
    return {
      id: row.incident, title: row.title, service: row.service, company: row.company,
      priority: row.level, fingerprint: row.fingerprint, status: 'Resolved', sample: true,
      occurredAt: row.openedAt, closedAt: row.closedAt, assignee: row.acceptedBy, closedBy: row.closedBy,
      summary: pitchRecordText(custom?.description),
      cause: pitchRecordText(reviewed?.cause),
      resolution: pitchRecordText(reviewed?.fix || row.fix),
      verification: pitchRecordText(reviewed?.verification),
      latestUpdate: row.via === 'telegram' && !reviewed ? 'Marked fixed in Telegram.' : '',
    };
  });
  for (const record of history) {
    closed.push({
      id: record.id, title: record.title, service: record.service, company: sampleCompanyFor(record.service),
      priority: record.priority, fingerprint: record.fingerprint, status: 'Archived', sample: true,
      occurredAt: Date.parse(`${record.date} ${sampleMonitoringDate.slice(0, 4)} 17:00 UTC`),
      assignee: record.responder, cause: record.cause, resolution: record.fix,
    });
  }

  const grouped = Object.values(state.custom).filter(record => record.groupedUnder && record.triggeredAt !== null)
    .map(record => ({
      id: record.id, title: record.title, service: record.service, company: record.company,
      priority: record.level, status: record.status === 'resolved' ? 'Resolved' : 'Grouped',
      groupedUnder: record.groupedUnder, sample: true, occurredAt: record.occurredAt,
      receivedAt: record.triggeredAt, summary: pitchRecordText(record.description),
    }));
  return {open, closed, grouped, selectedId, openCount: open.length, closedCount: closed.length};
}
