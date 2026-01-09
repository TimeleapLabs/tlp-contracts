import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("TLPStakingModule", (m) => {
  // Parameters for deployment - these should be set when deploying
  const tlpToken = m.getParameter("tlpToken");
  const treasury = m.getParameter("treasury");
  const admin = m.getParameter("admin");

  const staking = m.contract("TLPStaking", [tlpToken, treasury, admin]);

  return { staking };
});
