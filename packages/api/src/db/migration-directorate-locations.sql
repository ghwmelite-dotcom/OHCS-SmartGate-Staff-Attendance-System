-- Floor/location data for directorates that were missing it.
-- Safe to re-run: UPDATE by stable id, no schema changes.
UPDATE directorates SET floor = 'Rooms 52-53, Main Building Ground Floor'                       WHERE id = 'dir_accounts';
UPDATE directorates SET floor = 'Room 24'                                                        WHERE id = 'dir_csc';
UPDATE directorates SET floor = 'Room 51, Main Building Ground Floor'                           WHERE id = 'dir_estate';
UPDATE directorates SET floor = 'ANNEX Room 7'                                                   WHERE id = 'dir_iau';
UPDATE directorates SET floor = 'Deputy: Room 48 (Ground Floor), Director: Room 12 (2nd Floor)' WHERE id = 'dir_rcu';
UPDATE directorates SET floor = 'Room 35, 1st Floor'                                            WHERE id = 'dir_protocol';
UPDATE directorates SET floor = 'Room 1, 2nd Floor'                                             WHERE id = 'dir_pr';
UPDATE directorates SET floor = 'Room 28, 1st Floor'                                            WHERE id = 'dir_transport';
UPDATE directorates SET floor = 'Room 35, 1st Floor'                                            WHERE id = 'dir_gsu';
UPDATE directorates SET floor = 'ANNEX Room 7, 1st Floor'                                       WHERE id = 'dir_iau_sw';
UPDATE directorates SET floor = 'Room 48, Ground Floor'                                         WHERE id = 'dir_bcl';
UPDATE directorates SET floor = 'Rooms 38-39'                                                   WHERE id = 'dir_security';
