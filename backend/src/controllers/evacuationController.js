import evacuationService from "../services/evacuationService.js";

async function getTopology(req, res, next) {
  try {
    const topology = await evacuationService.getTopology();
    res.json(topology || { message: "Topology fallback" });
  } catch (error) {
    next(error);
  }
}

async function calculateRoutes(req, res, next) {
  try {
    const routes = await evacuationService.calculateRoutes(req.platformUser.id);
    res.json(routes);
  } catch (error) {
    next(error);
  }
}

async function calculateSingleRoute(req, res, next) {
  try {
    const { source, target_exit } = req.body || {};
    const route = await evacuationService.calculateSingleRoute(source, target_exit, req.platformUser.id);
    res.json(route);
  } catch (error) {
    next(error);
  }
}

async function calculateMaxFlow(req, res, next) {
  try {
    const { demands } = req.body || {};
    const flow = await evacuationService.calculateMaxFlow(demands, req.platformUser.id);
    res.json(flow);
  } catch (error) {
    next(error);
  }
}

export { getTopology, calculateRoutes, calculateSingleRoute, calculateMaxFlow };
