// Canonical joined SELECT for a single visit row with visitor + host + directorate.
// Callers bind a single param: the visit id. Shared by the check-in and check-out services.
export const SELECT_VISIT_WITH_JOINS = `SELECT v.*, vis.first_name, vis.last_name, vis.organisation, vis.photo_url,
        COALESCE(o.name, v.host_name_manual) as host_name, d.abbreviation as directorate_abbr,
        d.name as directorate_name, d.floor, d.wing
 FROM visits v
 JOIN visitors vis ON v.visitor_id = vis.id
 LEFT JOIN officers o ON v.host_officer_id = o.id
 LEFT JOIN directorates d ON v.directorate_id = d.id
 WHERE v.id = ?`;
