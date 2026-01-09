import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("TimeleapModule", (m) => {

  // TODO: Set addresses for the contract arguments below
  const timeleap = m.contract("Timeleap", [recipient]);

  return { timeleap };
});
