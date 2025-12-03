CREATE OR REPLACE FUNCTION get_milestone_rate_limits()
RETURNS TABLE (
  sustained_limit INTEGER,
  sustained_window_ms BIGINT,
  burst_limit INTEGER,
  burst_window_ms BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    10 as sustained_limit,
    3600000 as sustained_window_ms,
    3 as burst_limit,
    60000 as burst_window_ms;
END;
$$ LANGUAGE plpgsql;
