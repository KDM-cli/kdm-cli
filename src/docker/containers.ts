import { getDockerClient } from './client';

export interface ContainerData {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

export const getRunningContainers = async (): Promise<ContainerData[]> => {
  const docker = getDockerClient();
  try {
    const containers = await docker.listContainers();
    return containers.map((c) => ({
      id: c.Id.substring(0, 12),
      name: c.Names[0]?.replace('/', '') || 'Unknown',
      image: c.Image,
      state: c.State,
      status: c.Status,
    }));
  } catch (error) {
    return [];
  }
};
